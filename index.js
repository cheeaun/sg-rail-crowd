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
  const headers = event.request.headers;
  const userAgentStr = headers.get('User-Agent') || 'sg-rail-crowd/1.0';

  console.log('🚃 ' + pathname);
  let response;

  switch (pathname) {
    case '/favicon.ico': {
      return new Response(null, { status: 204 });
    }
    case '/testForecast': {
      const data = await fetch(API_FORECAST_URL + 'CCL', {
        headers: {
          accept: 'application/json',
          AccountKey: LTA_DATAMALL_ACCOUNT_KEY,
          'User-Agent': userAgentStr,
        },
      }).then(res => res.json());
      const bin = await fetch('https://httpbin.org/get').then(res =>
        res.json(),
      );
      const response = new Response(JSON.stringify({ data, bin }));
      response.headers.set('Content-Type', 'application/json');
      return response;
    }
    case '/forecast': {
      const results = JSON.parse(await CACHE.get('forecast')) || [];
      const errors = [];
      let cacheHit = true;
      if (!results || !results.length) {
        cacheHit = false;
        const responses = await Promise.allSettled(
          trainCodes.map((code, i) => {
            return new Promise(resolve => setTimeout(resolve, 2000 * i)).then(
              () => {
                console.log('🥏 ' + API_FORECAST_URL + code);
                return fetch(API_FORECAST_URL + code, {
                  headers: {
                    accept: 'application/json',
                    AccountKey: LTA_DATAMALL_ACCOUNT_KEY,
                    'User-Agent': userAgentStr,
                  },
                }).then(res => res.json());
              },
            );
          }),
        );
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
        if (!errors.length) {
          // Tomorrow at 12AM SGT timezone, in epoch seconds
          const expiration = new Date(
            new Date().setHours(0, 0, 0, 0) + 24 * 60 * 60 * 1000,
          ).getTime();
          event.waitUntil(
            CACHE.put('forecast', JSON.stringify(results), {
              expiration,
            }),
          );
        }
      }
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
      response.headers.set('x-kv-cache', cacheHit ? 'HIT' : 'MISS');
      break;
    }
    case '/': {
      const results = JSON.parse(await CACHE.get('realtime')) || [];
      const errors = [];
      let cacheHit = true;
      if (!results || !results.length) {
        cacheHit = false;
        const responses = await Promise.allSettled(
          trainCodes.map(code => {
            console.log('🥏 ' + API_URL + code);
            return fetch(API_URL + code, {
              headers: {
                accept: 'application/json',
                AccountKey: LTA_DATAMALL_ACCOUNT_KEY,
                'User-Agent': userAgentStr,
              },
            }).then(res => res.json());
          }),
        );
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
        if (!errors.length) {
          event.waitUntil(
            CACHE.put('realtime', JSON.stringify(results), {
              expirationTtl: 300,
            }),
          );
        }
      }
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
      response.headers.set('x-kv-cache', cacheHit ? 'HIT' : 'MISS');
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
