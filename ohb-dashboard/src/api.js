const API_BASE = `http://${window.location.hostname}:3001/api`;

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// -- Cleanrooms --
export const getCleanrooms   = ()     => request('/cleanrooms');
export const createCleanroom = (name) => request('/cleanrooms', { method: 'POST', body: JSON.stringify({ name }) });
export const deleteCleanroom = (id)   => request(`/cleanrooms/${id}`, { method: 'DELETE' });

// -- Sensors (sensor_registry) --
export const getSensors     = ()             => request('/sensors');
export const renameSensor   = (sensor_uuid, name) =>
  request(`/sensors/${sensor_uuid}`, { method: 'PATCH', body: JSON.stringify({ name }) });
export const deleteSensor   = (sensor_uuid) => request(`/sensors/${sensor_uuid}`, { method: 'DELETE' });

// -- Assignments --
export const getAssignments       = ()             => request('/assignments');
export const getAssignmentHistory = (sensor_uuid)  => request(`/assignments/history?sensor_uuid=${sensor_uuid}`);
export const createAssignment     = (sensor_uuid, cleanroom_id) =>
  request('/assignments', { method: 'POST', body: JSON.stringify({ sensor_uuid, cleanroom_id }) });

// -- Thresholds --
export const getThresholds = (sensor_uuid) =>
  request(`/thresholds${sensor_uuid ? `?sensor_uuid=${sensor_uuid}` : ''}`);
export const setThreshold  = (sensor_uuid, quantity, min_value, max_value) =>
  request('/thresholds', { method: 'POST', body: JSON.stringify({ sensor_uuid, quantity, min_value, max_value }) });
export const deleteThreshold = (id) =>
  request(`/thresholds/${id}`, { method: 'DELETE' });

// -- Sensor Data --
export const getSensorData = (sensor_uuid, quantity, from, to, limit) => {
  const params = new URLSearchParams({ sensor_uuid, quantity });
  if (from)  params.set('from', from);
  if (to)    params.set('to', to);
  if (limit) params.set('limit', limit);
  return request(`/sensordata?${params}`);
};

export const getSensorMetrics = (sensor_uuid) =>
  request(`/sensordata/metrics?sensor_uuid=${sensor_uuid}`);

// -- Violations --
export const getViolations = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/violations${qs ? `?${qs}` : ''}`);
};
export const acknowledgeViolation = (id) =>
  request(`/violations/${id}/acknowledge`, { method: 'PATCH' });

// -- Report --
export const generateReport = async (cleanroom_id, from, to) => {
  const res = await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cleanroom_id, from, to }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.blob();
};
