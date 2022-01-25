const bodyParser = require('body-parser');
const { program } = require('commander');
const express = require('express');

const app = express();

const ACTION_RESTART = 'restart';
const ACTION_TERMINATE = 'terminate';

const STATUS_INITIALIZING = 'INITIALIZING';
const STATUS_ACTIVE = 'ACTIVE';
const STATUS_FAILED = 'FAILED';
const STATUS_RESTARTING = 'RESTARTING';
const STATUS_TERMINATING = 'TERMINATING';

let nextId = 1;
const sensors = [];

program.option('-u, --unreliable', 'Run unreliably with errors.');
program.option('-f, --fail-sensors', 'Intermittently fail sensors.');
program.parse(process.argv);

const options = program.opts();

// Always parse json even if Content-Type header is missing
app.use(bodyParser.json({
  type(req) {
    return true;
  }
}))

app.use((err, req, res, next) => {
  // This check makes sure this is a JSON parsing issue, but it might be
  // coming from any middleware, not just body-parser:
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.log(`invalid json: '${err.body}'`);
    return res.status(400).json({ error: `invalid json: received '${err.body}'` });
  }
  next();
});

function logMiddleware(req, res, next) {
  console.log(`${req.method} ${req.originalUrl} ...`);
  const startedAt = new Date().valueOf();
  res.on('finish', () => {
    const reqDurationMsec = new Date().valueOf() - startedAt;
    console.log(
      `${req.method} ${req.originalUrl} - ` +
      `${res.statusCode} ${res.statusMessage} - ` +
      `${reqDurationMsec}ms - ` +
      `${res.get('Content-Length') || 0}b sent`
    );
  });
  next();
}

// Log requests
app.use(logMiddleware);

const isUnreliable = options.unreliable;
console.log(`Running in ${isUnreliable ? 'unreliable' : 'reliable'} mode.`);

const shouldFailSensors = options.failSensors;
console.log(`Running ${shouldFailSensors ? 'with' : 'without'} intermittent sensor failure.`);

// Request delays
const DELAY_REQ_MIN = 0;
const DELAY_REQ_MAX = 1000;

// Action delays
const DELAY_ACTION_MIN = 2000;
const DELAY_ACTION_MAX = 5000;

// Error rates
const ERROR_HANG_RATE = options.unreliable ? 0.05 : 0;
const ERROR_502_RATE = options.unreliable ? 0.05 : 0;
const ERROR_CLOSE_RATE = options.unreliable ? 0.05 : 0;
const ERROR_TEXT_ERROR = options.unreliable ? 0.05 : 0;

// Failure rate
const FAILURE_INTERVAL = 10000;
const FAILURE_RATE = shouldFailSensors ? 0.2 : 0;

// Measurement rate
const MEASUREMENT_INTERVAL = 3000;

const ERROR_TEXT_CONTENT = 'This site is inaccessible. Please try again.';

function getRequestDelay() {
  return DELAY_REQ_MIN + Math.random() * (DELAY_REQ_MAX - DELAY_REQ_MIN);
}

function getActionDelay() {
  return DELAY_ACTION_MIN + Math.random() * (DELAY_ACTION_MAX - DELAY_ACTION_MIN);
}

function requestDelayMiddleware(req, res, next) {
  setTimeout(next, getRequestDelay());
}

function randomErrorsMiddleware(req, res, next) {
  let errorRoll = Math.random();
  // Hang
  errorRoll -= ERROR_HANG_RATE;
  if (errorRoll < 0) {
    return;
  }
  // 502
  errorRoll -= ERROR_502_RATE;
  if (errorRoll < 0) {
    res.status(502);
    return;
  }
  // Closed connection
  errorRoll -= ERROR_CLOSE_RATE;
  if (errorRoll < 0) {
    res.connection.destroy();
    return;
  }
  // Text error - causes JSON parse errors
  errorRoll -= ERROR_TEXT_ERROR;
  if (errorRoll < 0) {
    res.status(500).send(ERROR_TEXT_CONTENT);
    return;
  }
  // Passed the gauntlet of errors!
  next();
}

function actionAfterDelay(callback) {
  setTimeout(callback, getActionDelay());
}

function getSensorIdsRoute(req, res) {
  res.json(sensors.map(s => s.id));
}

function createSensorRoute(req, res) {
  const frequency = req.body.frequency;
  if (Number.isNaN(frequency)) {
    res.status(400).json({ 'error': 'missing frequency' });
    return;
  }
  if (!Number.isInteger(frequency)) {
    res.status(400).json({ 'error': 'invalid frequency' });
    return;
  }
  const newSensor = {
    id: nextId++,
    frequency: frequency,
    status: STATUS_INITIALIZING,
    measurement: null,
  }
  sensors.push(newSensor);
  actionAfterDelay(() => newSensor.status = STATUS_ACTIVE);
  res.json(newSensor);
}

function getSensorRoute(req, res) {
  const sensorId = Number(req.params.id);
  if (!sensorId || Number.isNaN(sensorId)) {
    res.status(400).json({ 'error': 'invalid id' });
    return;
  }
  const sensor = sensors.find(s => s.id === sensorId);
  if (!sensor) {
    res.status(404).json({ 'error': 'not found' });
    return;
  }
  res.json(sensor);
}

function changeSensorRoute(req, res) {
  const sensorId = Number(req.params.id);
  if (!sensorId || Number.isNaN(sensorId)) {
    res.status(400).json({ 'error': 'invalid id' });
    return;
  }
  const sensor = sensors.find(s => s.id === sensorId);
  if (!sensor) {
    res.status(404).json({ 'error': 'not found' });
    return;
  }
  if (![STATUS_ACTIVE, STATUS_FAILED].includes(sensor.status)) {
    res.status(400).json({ 'error': `sensor status is ${sensor.status}` });
    return;
  }
  const action = req.params.action;
  if (action === ACTION_RESTART) {
    // Restart
    sensor.status = STATUS_RESTARTING;
    actionAfterDelay(() => sensor.status = STATUS_ACTIVE);
  } else if (action === ACTION_TERMINATE) {
    // Terminate
    sensor.status = STATUS_TERMINATING;
    actionAfterDelay(() => sensors.splice(sensors.indexOf(sensor), 1));
  } else {
    res.status(400).json({ 'error': 'invalid action' });
    return;
  }
  res.json({ 'ok': true });
}

function triggerIntermittentFailures() {
  for (let i = 0; i < sensors.length; i++) {
    if (sensors[i].status === STATUS_ACTIVE) {
      if (Math.random() < FAILURE_RATE) {
        sensors[i].status = STATUS_FAILED;
      }
    }
  }
}

function getMeasurement() {
  return Math.random() * 100;
}

function triggerMeasurements() {
  for (let i = 0; i < sensors.length; i++) {
    if (sensors[i].status === STATUS_ACTIVE) {
      sensors[i].measurement = getMeasurement();
    }
  }
}

// Index
app.get('/', (req, res) => {
  res.send('Greetings from space!');
});

// Routes
app.get('/sensor-ids',
  requestDelayMiddleware,
  randomErrorsMiddleware, 
  getSensorIdsRoute);

app.post('/sensors',
  requestDelayMiddleware,
  randomErrorsMiddleware, 
  createSensorRoute);

app.get('/sensors/:id',
  requestDelayMiddleware,
  randomErrorsMiddleware, 
  getSensorRoute);

app.post('/sensors/:id/:action',
  requestDelayMiddleware,
  randomErrorsMiddleware, 
  changeSensorRoute);

// Debug route
app.get('/debug', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify(sensors, null, 2));
});

app.use((err, req, res, next) => {
  console.log('err', err);
  res.status(500, { error: err.message });
});

// Listen
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Sensor API listening at http://localhost:${port}`)
});

// Set update interval
setInterval(triggerIntermittentFailures, FAILURE_INTERVAL);
setInterval(triggerMeasurements, MEASUREMENT_INTERVAL);