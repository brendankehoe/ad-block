"strict mode";

// Set to true to get noisier console.log statements
VERBOSE_DEBUG = false;

// Temporary...
var SAFARI = false;

// Global variable for Opera, so we can make specific things for Opera
OPERA = navigator.userAgent.indexOf("OPR") > -1;

// Enabled in adblock_start_common.js and background.js if the user wants
logging = function(enabled)
{
  if (enabled)
  {
    log = function()
    {
      if (VERBOSE_DEBUG || arguments[0] != '[DEBUG]') // comment out for
        // verbosity
        console.log.apply(console, arguments);
    };
    logGroup = function()
    {
      console.group.apply(console, arguments);
    };
    logGroupEnd = function()
    {
      console.groupEnd();
    };
  }
  else
  {
    log = logGroup = logGroupEnd = function()
    {
    };
  }
};
logging(false); // disabled by default

// Behaves very similarly to $.ready() but does not require jQuery.
onReady = function(callback)
{
  if (document.readyState === "complete")
  {
    window.setTimeout(callback, 0);
  }
  else
  {
    window.addEventListener("load", callback, false);
  }
};

// Excecute any bandaid for the specific site, if the bandaids.js was loaded.
onReady(function()
{
  if (typeof run_bandaids === "function")
  {
    run_bandaids();
  }
});

translate = function(messageID, args)
{
  return chrome.i18n.getMessage(messageID, args);
};

localizePage = function()
{
  // translate a page into the users language
  $("[i18n]:not(.i18n-replaced)").each(function()
  {
    $(this).html(translate($(this).attr("i18n")));
  });
  $("[i18n_value]:not(.i18n-replaced)").each(function()
  {
    $(this).val(translate($(this).attr("i18n_value")));
  });
  $("[i18n_title]:not(.i18n-replaced)").each(function()
  {
    $(this).attr("title", translate($(this).attr("i18n_title")));
  });
  $("[i18n_placeholder]:not(.i18n-replaced)").each(function()
  {
    $(this).attr("placeholder", translate($(this).attr("i18n_placeholder")));
  });
  $("[i18n_replacement_el]:not(.i18n-replaced)").each(function()
  {
    // Replace a dummy <a/> inside of localized text with a real element.
    // Give the real element the same text as the dummy link.
    var dummy_link = $("a", this);
    var text = dummy_link.text();
    var real_el = $("#" + $(this).attr("i18n_replacement_el"));
    real_el.text(text).val(text).replaceAll(dummy_link);
    // If localizePage is run again, don't let the [i18n] code above
    // clobber our work
    $(this).addClass("i18n-replaced");
  });

  // Make a right-to-left translation for Arabic and Hebrew languages
  var language = determineUserLanguage();
  if (language === "ar" || language === "he")
  {
    $("#main_nav").removeClass("right").addClass("left");
    $(".adblock-logo").removeClass("left").addClass("right");
    $(".closelegend").css("float", "left");
    document.documentElement.dir = "rtl";
  }
};

// Determine what language the user's browser is set to use
determineUserLanguage = function()
{
  return navigator.language.match(/^[a-z]+/i)[0];
};

// Parse a URL. Based upon http://blog.stevenlevithan.com/archives/parseuri
// parseUri 1.2.2, (c) Steven Levithan <stevenlevithan.com>, MIT License
// Inputs: url: the URL you want to parse
// Outputs: object containing all parts of |url| as attributes
parseUri = function(url)
{
  var matches = /^(([^:]+(?::|$))(?:(?:\w+:)?\/\/)?(?:[^:@\/]*(?::[^:@\/]*)?@)?(([^:\/?#]*)(?::(\d*))?))((?:[^?#\/]*\/)*[^?#]*)(\?[^#]*)?(\#.*)?/.exec(url);
  // The key values are identical to the JS location object values for that key
  var keys = ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"];
  var uri = {};
  for (var i = 0; (matches && i < keys.length); i++)
    uri[keys[i]] = matches[i] || "";
  return uri;
};
// Parses the search part of a URL into an key: value object.
// e.g., ?hello=world&ext=adblock would become {hello:"world", ext:"adblock"}
// Inputs: search: the search query of a URL. Must have &-separated values.
parseUri.parseSearch = function(search)
{
  // Fails if a key exists twice (e.g., ?a=foo&a=bar would return {a:"bar"}
  search = search.substring(search.indexOf("?") + 1).split("&");
  var params = {}, pair;
  for (var i = 0; i < search.length; i++)
  {
    pair = search[i].split("=");
    if (pair[0] && !pair[1])
      pair[1] = "";
    if (!params[decodeURIComponent(pair[0])] && decodeURIComponent(pair[1]) === "undefined")
    {
      continue;
    }
    else
    {
      params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
  }
  return params;
};
// Strip third+ level domain names from the domain and return the result.
// Inputs: domain: the domain that should be parsed
// keepDot: true if trailing dots should be preserved in the domain
// Returns: the parsed domain
parseUri.secondLevelDomainOnly = function(domain, keepDot)
{
  if (domain)
  {
    var match = domain.match(/([^\.]+\.(?:co\.)?[^\.]+)\.?$/) || [domain, domain];
    return match[keepDot ? 0 : 1].toLowerCase();
  }
  else
  {
    return domain;
  }
};

// Inputs: key:string.
// Returns value if key exists, else undefined.
sessionstorage_get = function(key)
{
  var json = sessionStorage.getItem(key);
  if (json == null)
    return undefined;
  try
  {
    return JSON.parse(json);
  }
  catch (e)
  {
    log("Couldn't parse json for " + key);
    return undefined;
  }
};

// Inputs: key:string.
// Returns value if key exists, else undefined.
sessionstorage_set = function(key, value)
{
  if (value === undefined)
  {
    sessionStorage.removeItem(key);
    return;
  }
  try
  {
    sessionStorage.setItem(key, JSON.stringify(value));
  }
  catch (ex)
  {
    if (ex.name == "QUOTA_EXCEEDED_ERR" && !SAFARI)
    {
      alert(translate("storage_quota_exceeded"));
      openTab("options/index.html#ui-tabs-2");
    }
  }
};

// Run a function on the background page.
// Inputs (positional):
// first, a string - the name of the function to call
// then, any arguments to pass to the function (optional)
// then, a callback:function(return_value:any) (optional)
BGcall = function()
{
  var args = [];
  for (var i = 0; i < arguments.length; i++)
    args.push(arguments[i]);
  var fn = args.shift();
  var has_callback = (typeof args[args.length - 1] == "function");
  var callback = (has_callback ? args.pop() : function()
  {
  });
  ext.backgroundPage.sendMessage({
    command : "call",
    fn : fn,
    args : args
  }, callback);
};