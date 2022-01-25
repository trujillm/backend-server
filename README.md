# Simulate a backend API server for API

Utilized for Practicing API requests as a backend API

## Requirements

* ngrok (`brew install ngrok`) for port tunnelling
* nodejs 12+

## Running locally

To run:

```sh
# Run the server in one tab
npm install
node app.js

# In a separate tab, run ngrok, copy the `https://xxxxxx.ngrok.io` URL and
# use as dev server.
ngrok http 3000
```

## Usage

List sensors

```sh
# Using real endpoint
curl -s http://localhost:3000/sensor-ids | \
  jq -r '.[]' | \
  xargs -I '{}' curl -s "http://localhost:3000/sensors/{}"

# Debug endpoint
curl -s http://localhost:3000/debug
```

Add a sensor:

```sh
curl -X POST http://localhost:3000/sensors \
  -H 'Content-Type: application/json' \
  --data '{"frequency": 2 }'
```

Restart a sensor:

```sh
curl -X POST http://localhost:3000/sensors/1/restart
```

## Options

`node app.js` will start in reliable mode (no request failures)

`node app.js --unreliable` will start in unreliable mode (simulate request / connection failures)

`node app.js --fail-sensors` will intermittently put sensors in a FAILED state
