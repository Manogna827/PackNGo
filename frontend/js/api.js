import { getCurrentUser } from "./firebase.js";

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  const token = await user.getIdToken();
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers }
  };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error("PackNGo could not reach the server. Check your connection and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
