;(function(kx){
	"use strict";


	/**
	 *  Provide a uniform interface to decorate modules with extra properties and methods
	 */
	function Decorator()
	{
		if (!(this instanceof Decorator))
			return new Decorator();
		else if ('undefined' !== typeof Decorator.prototype.___instance)
			return Decorator.prototype.___instance;
		Decorator.prototype.___instance = this;

		var decorator = this;


		/**
		 *  Convert underscore-notation to camelCase-notation
		 *  @name    camelCase
		 *  @type    function
		 *  @access  internal
		 *  @param   string  name
		 *  @param   bool    upper [optional, default false - lowerCamelCase]
		 *  @return  string  camelCased name
		 *  @note    the input name is _not_ lowercased for you
		 */
		function camelCase(name, upper)
		{
			var i;

			// for as long a '_' characters are found, remove them and uppercase the next character
			while ((i = name.indexOf('_', i)) >= 0)
				name = name.substr(0, i) + name.charAt(++i).toUpperCase() + name.substring(i + 1);

			//  if 'upper' resolves to true-ish, the first character will we uppercased as well
			return upper ? name.charAt(0).toUpperCase() + name.substring(1) : name;
		}

		/**
		 *  Iterate through the target members, ensuring camelCase for any member name
		 *  @name    recursiveCamelCaseMembers
		 *  @type    function
		 *  @access  internal
		 *  @param   mixed  target
		 *  @return  mixed  target
		 */
		function recursiveCamelCaseMembers(target)
		{
			var key, value;

			switch (typeof target)
			{
				case 'object':
					if (target instanceof Array)
					{
						value = [];
						for (key = 0; key < target.length; ++key)
							value[key] = recursiveCamelCaseMembers(target[key]);
					}
					else
					{
						value = {};
						for (key in target)
							value[camelCase(key)] = recursiveCamelCaseMembers(target[key]);
					}
					target = value;
					break;
			}

			return target;
		}

		/**
		 *  Apply given key/value pair to the target
		 *  @name    decorate
		 *  @type    function
		 *  @access  internal
		 *  @param   Object  target
		 *  @param   string  key
		 *  @param   mixed   value
		 *  @param   void
		 */
		function decorate(target, key, value)
		{
			//  apply camelCasing syntax
			key = camelCase(key);

			//  try to maintain the camelCase notation, even across child members
			value = recursiveCamelCaseMembers(value);

			//  attempt to define the property the proper way (feature detection cannot be used
			//  here, due to IE8 supporting the defineProperty, but only om DOMNode objects)
			try {
				Object.defineProperty(target, key, {enumerable: true, value: value});
			}
			catch(e) {
				//  simple key/value association, be aware that these are still writable, but only
				//  in certain browsers
				target[key] = value;
			}
		}

		decorator.property = function(target, key, value)
		{
			decorate(target, camelCase(key), value);
		};

		decorator.method = function(target, name, settings, ready)
		{
			decorator.property(target, camelCase(name), function(){
				var arg = Array.prototype.slice.call(arguments),
					param = kx.combine(settings.param || {}),
					callback = 'function' === typeof arg[arg.length - 1] ? arg.pop() : null,
					error = [],
					p;

				if ('param' in settings)
					for (p in settings.param)
						if (settings.param[p] === '#')  //  parameter required
						{
							if (arg.length)
								param[p] = arg.shift();
							else
								error.push(p);
						}

				//  if there is no callback, we create one which provides feedback about it once it returns
				if (!callback)
					callback = function(error, result, next){
						throw new Error('No callback function provided for ' + name + ' method');
					};

				//  if there are errors, we call the callback functions with an object:
				//  {id:'error_<fields>':, message: 'Missing argument(s): <fields>'}
				if (error.length > 0)
					return callback({
						id: 'error_' + error.join('_'),
						message: 'Missing argument(s): "' + error.join('", "') +'" for ' + name + ' method'
					});

				return ready(param, callback);
			});
		};

		return decorator;
	}


	/**
	 *  Provide all features from the Digital Ocean API (v2)
	 */
	function DigitalOceanAPIv2()
	{
		var api = this,
			baseURL = 'https://api.digitalocean.com/v2/',
			token;


		/**
		 *  Execute an XMLHTTPRequest
		 *  @name    request
		 *  @type    function
		 *  @access  internal
		 *  @param   string    request method
		 *  @param   string    endpoint
		 *  @param   object    parameters
		 *  @param   function  callback
		 *  @return  void
		 */
		function request(method, endpoint, param, callback)
		{
			var config;

			if (!token)
				throw new Error('Token not found, use DOv2.token(<your token here>) to set it');

			config = {
				type: method,
				url: (/^http/.test(endpoint) ? '' : baseURL) + endpoint,
				header: {
					Authorization: 'Bearer ' + token
				},
				success: function(status, response){
					callback(null, response);
				},
				error: function(status, response){
					callback(response);
				}
			};

			if (param)
				config.data = param;

			kx.ajax.request(config);
		}

		/**
		 *  Resolve variable placeholders in a string (URL) using given data object
		 *  @name    resolve
		 *  @type    function
		 *  @access  internal
		 *  @param   string  input
		 *  @param   object  data source
		 *  @param   bool    preserve [optional, default false-ish - do not preserve variables in data source]
		 *  @return  string  resolved
		 */
		function resolve(string, data, preserve)
		{
			var pattern = /\{([a-z]+)\}/i,
				match, replace;

			while ((match = pattern.exec(string)))
			{
				replace = match[1] in data ? data[match[1]] : '';
				string = string.replace(match[0], replace);
				if (!preserve && replace)
					delete data[match[1]];
			}

			return string;
		}

		/**
		 *  Process the reply from Digital Oceans' API
		 *  @name    process
		 *  @type    function
		 *  @access  internal
		 *  @param   string    noun
		 *  @param   mixed     result
		 *  @param   function  callback
		 *  @param   object    decoration to apply on the Item(s) created
		 *  @return  bool      success
		 */
		function process(noun, result, callback, decoration)
		{
			var key = noun,
				next = null,
				list = [],
				i;

			if (!(key in result))
			{
				//  API calls which return a single item by default don't use the plural form of the noun
				if (key.charAt(key.length - 1) !== 's' || !(key.substr(0, key.length - 1) in result))
					return false;

				key = key.substr(0, key.length - 1);
			}

			if (result[key] instanceof Array)
				for (i = 0; i < result[key].length; ++i)
					list.push(new Item(noun, result[key][i], decoration));
			else
				list = new Item(noun, result[key], decoration);

			if ('links' in result && 'pages' in result.links && 'next' in result.links.pages)
				next = function(callback){
					request('get', result.links.pages.next, '', function(error, result, next){
						if (error)
							return callback(error);
						return process(key, result, callback, decoration);
					});
				};

			callback.apply(null, [null, list].concat(next ? [next] : []));

			return true;
		}


		/**
		 *  Dynamically create an Item module representing a single item in any Endpoint
		 *  @name    Item
		 *  @type    constructor function
		 *  @access  internal
		 *  @param   string  REST-noun
		 *  @param   object  data
		 *  @param   object  api decorations to apply
		 *  @return  Item    instance
		 */
		function Item(noun, data, decoration)
		{
			var item = this;


			/**
			 *  Initialize the Endpoint instance
			 *  @name    init
			 *  @type    function
			 *  @access  internal
			 *  @return  void
			 */
			function init()
			{
				var key, settings;

				for (key in data)
					new Decorator().property(item, key, data[key]);

				for (key in decoration)
				{
					//  _actions are automatically bound to a specific Item instance, resolving the id's and
					//  other requirements
					if (key === '_actions')
					{
						for (key in decoration._actions)
							decorateMethod(key, kx.combine({
								endpoint: '{id}/actions',
								param: {
									id: item.id,
									type: key.toLowerCase()
								},
								method: 'post'
							}, decoration._actions[key]));
					}
					else
					{
						decorateMethod(key, kx.combine({
							endpoint: '{id}/' + key,
							param: {
								id: item.id
							}
						}, decoration[key]));
					}
				}
			}

			/**
			 *  Dynamically create a method on the endpoint object
			 *  @name    decorateMethod
			 *  @type    function
			 *  @access  internal
			 *  @param   string  key
			 *  @param   object  settings
			 *  @return  void
			 */
			function decorateMethod(key, settings)
			{
				new Decorator().method(item, key, settings, function(param, callback){
					request(settings.method || 'get', [noun, 'endpoint' in settings ? resolve(settings.endpoint, param) : ''].join('/'), param, function(error, result, next){
						if (error)
							return callback(error);

						return process(key, result, callback);
					});
				});
			}

			init();
		}


		/**
		 *  Dynamically create an Endpoint module handling all calls to a single API noun
		 *  @name    Endpoint
		 *  @type    constructor function
		 *  @access  internal
		 *  @param   string  REST-noun
		 *  @param   object  api decorations to apply
		 *  @return  Endpoint instance
		 */
		function Endpoint(noun, decoration)
		{
			var endpoint = this,
				list = [],
				itemDecoration;


			/**
			 *  Initialize the Endpoint instance
			 *  @name    init
			 *  @type    function
			 *  @access  internal
			 *  @return  void
			 */
			function init()
			{
				var key, settings;

				if ('object' === typeof decoration)
					for (key in decoration)
					{
						if (/^_[a-z]+/i.test(key))
						{
							if (key === '_item')
								itemDecoration = decoration[key];
							//  anything other starting with an underscore is ignored at this level
						}
						else
						{
							decorateMethod(key, decoration[key]);
						}
					}
			}

			/**
			 *  Dynamically create a method on the endpoint object
			 *  @name    decorateMethod
			 *  @type    function
			 *  @access  internal
			 *  @param   string  key
			 *  @param   object  settings
			 *  @return  void
			 */
			function decorateMethod(key, settings)
			{
				new Decorator().method(endpoint, key, settings, function(param, callback){
					request(settings.method || 'get', [noun, resolve(settings.endpoint, param)].join('/'), param, function(error, result, next){
						if (error)
							return callback(error);

						return process(noun, result, callback, itemDecoration);
					});
				});
			}

			/**
			 *  Obtain a list of items for the endpoint
			 *  @name    list
			 *  @type    method
			 *  @access  public
			 *  @param   function callback [signature: error, result, next]
			 *  @return  void
			 */
			endpoint.list = function(callback)
			{
				request('get', noun, '', function(error, result, next){
					if (error)
						throw new Error(error);

					process(noun, result, callback, itemDecoration);
				});
			};

			init();
		}


		/**
		 *  Set the API Token
		 *  @name    token
		 *  @type    method
		 *  @access  public
		 *  @param   string token
		 *  @return  void
		 */
		api.token = function(value)
		{
			token = value;
		};


		/**
		 *  Actions API implementation
		 *   - list(function callback)
		 *   - id(number id, function callback)
		 *  Item(s) in the result do not have methods of their own
		 */
		api.Actions = new Endpoint('actions', {
			id: {endpoint:'{id}', param:{id:'#'}}
		});

		/**
		 *  Regions API implementation
		 *   - list(function callback)
		 */
		api.Regions = new Endpoint('regions');

		/**
		 *  Sizes API implementation
		 *   - list(function callback)
		 */
		api.Sizes = new Endpoint('sizes');

		/**
		 *  Droplets API implementation
		 *   - list(function callback)
		 *   - id(number id, function callback)
		 *   Item(s) in result have the following methods:
		 *   - kernels(function callback)
		 *   - snapshots(function callback)
		 *   - backups(function callback)
		 *   - destroy(number id, function callback)
		 *   - actions(function callback)
		 *   Actions:
		 *   - reboot(function callback)
		 *   - powerCycle(function callback)
		 *   - powerOn(function callback)
		 *   - powerOff(function callback)
		 *   - passwordReset(function callback)
		 *   - resize(size slug, function callback)
		 *   - restore(string imageSlug, function callback)
		 *   - rebuild(string imageSlug || number imageId, function callback)
		 *   - rename(string name, function callback)
		 *   - changeKernel(string kernel, function callback)
		 *   - enableIPv6(function callback)
		 *   - disableBackups(function callback)
		 *   - enablePrivateNetworking(function callback)
		 */
		api.Droplets = new Endpoint('droplets', {
			id: {endpoint:'{id}', param:{id:'#'}},
			_item: {
				kernels: {},
				snapshots: {},
				backups: {},
				actions: {},
				destroy: {method:'delete', endpoint:'{id}'},
				_actions: {
					reboot: {},
					power_cycle: {},
					shutdown: {},
					power_on: {},
					power_off: {},
					password_reset: {},
					resize: {param:{size:'#'}},
					restore: {param:{image:'#'}},
					rebuild: {param:{imageOrSlug:'#'}},
					rename: {param:{name:'#'}},
					change_kernel: {param:{kernel:'#'}},
					enable_IPv6: {},
					disable_backups: {},
					enable_private_networking: {}
				}
			}
		});

		/**
		 *  Images API implementation
		 *   - list(function callback)
		 *   - id(number id, function callback)
		 *   Item(s) in result have the following methods:
		 *   - update(string imageName, function callback)
		 *   - transfer(string regionSlug, function callback)
		 *   - destroy(function callback)
		 */
		api.Images = new Endpoint('images', {
			id: {endpoint:'{id}', param:{id:'#'}},
			_item: {
				_actions: {
					update: {method:'put', endpoint: '{id}', param:{name:'#'}},
					transfer: {method:'post', param:{region:'#'}},
					destroy: {method:'delete', endpoint:'{id}'}
				}
			}
		});

		//TODO: implement DNS and Keys Endpoints
	}

	window.DOv2 = new DigitalOceanAPIv2();

})(konflux);