const API_URL =
  'http://datamall2.mytransport.sg/ltaodataservice/PCDRealTime?TrainLine=';
const API_FORECAST_URL =
  'http://datamall2.mytransport.sg/ltaodataservice/PCDForecast?TrainLine=';
const trainCodes = [
  'CCL',
  'CEL',
  'CGL',
  'DTL',
  'EWL',
  'NEL',
  'NSL',
  'BPL',
  'SLRT',
  'PLRT',
];

// https://stackoverflow.com/a/26215431
function toCamel(o) {
  var newO, origKey, newKey, value;
  if (o instanceof Array) {
    return o.map(function(value) {
      if (typeof value === 'object') {
        value = toCamel(value);
      }
      return value;
    });
  } else {
    newO = {};
    for (origKey in o) {
      if (o.hasOwnProperty(origKey)) {
        newKey = (
          origKey.charAt(0).toLowerCase() + origKey.slice(1) || origKey
        ).toString();
        value = o[origKey];
        if (
          value instanceof Array ||
          (value !== null && value.constructor === Object)
        ) {
          value = toCamel(value);
        }
        newO[newKey] = value;
      }
    }
  }
  return newO;
}

function handleOptions(request) {
  // Make sure the necessary headers are present
  // for this to be a valid pre-flight request
  let headers = request.headers;
  if (
    headers.get('Origin') !== null &&
    headers.get('Access-Control-Request-Method') !== null &&
    headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS pre-flight request.
    // If you want to check or reject the requested method + headers
    // you can do that here.
    let respHeaders = {
      ...corsHeaders,
      // Allow all future content Request headers to go back to browser
      // such as Authorization (Bearer) or X-Client-Name-Version
      'Access-Control-Allow-Headers': request.headers.get(
        'Access-Control-Request-Headers',
      ),
    };

    return new Response(null, {
      headers: respHeaders,
    });
  } else {
    // Handle standard OPTIONS request.
    // If you want to allow other HTTP Methods, you can do that here.
    return new Response(null, {
      headers: {
        Allow: 'GET, HEAD, POST, OPTIONS',
      },
    });
  }
}

async function eventHandler(event) {
  const url = new URL(event.request.url);
  const { pathname } = url;

  console.log('🚃 ' + pathname);
  let response;

  switch (pathname) {
    case '/favicon.ico': {
      return new Response(null, { status: 204 });
    }
    case '/forecast': {
      const responses = await Promise.allSettled(
        trainCodes.map(code => {
          console.log('🥏 ' + code);
          return fetch(API_FORECAST_URL + code, {
            headers: {
              AccountKey: LTA_DATAMALL_ACCOUNT_KEY,
            },
            cf: {
              cacheTtl: 5 * 60, // seconds
              cacheEverything: true,
            },
          }).then(res => res.json());
        }),
      );
      const results = [];
      const errors = [];
      responses
        .filter(res => res.status === 'fulfilled')
        .forEach(res => {
          const { value, fault } = res.value;
          if (fault) {
            errors.push(fault.detail.errorcode);
            return;
          }
          const result = value.map(obj => toCamel(obj));
          results.push(...result);
        });
      response = new Response(
        JSON.stringify({
          data: results,
          meta: {
            count: results.length,
            errors,
          },
        }),
      );
      response.headers.set('Cache-Control', 'public, max-age=3600'); // 1 hour
      break;
    }
    case '/': {
      const responses = await Promise.allSettled(
        trainCodes.map(code => {
          console.log('🥏 ' + code);
          return fetch(API_URL + code, {
            headers: {
              AccountKey: LTA_DATAMALL_ACCOUNT_KEY,
            },
            cf: {
              cacheTtl: 5 * 60, // seconds
              cacheEverything: true,
            },
          }).then(res => res.json());
        }),
      );
      const results = [];
      const errors = [];
      responses
        .filter(res => res.status === 'fulfilled')
        .forEach(res => {
          const { value, fault } = res.value;
          if (fault) {
            errors.push(fault.detail.errorcode);
            return;
          }
          const result = value.map(obj => toCamel(obj));
          results.push(...result);
        });
      response = new Response(
        JSON.stringify({
          data: results,
          meta: {
            count: results.length,
            errors,
          },
        }),
      );
      response.headers.set('cache-control', 'public, max-age=300'); // 5 mins
      break;
    }
    default: {
      response = new Response(null, { status: 404 });
    }
  }

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.append('Vary', 'Origin');
  return response;
}

addEventListener('fetch', event => {
  const request = event.request;
  if (request.method === 'OPTIONS') {
    // Handle CORS preflight requests
    event.respondWith(handleOptions(request));
  } else {
    event.respondWith(eventHandler(event));
  }
});
