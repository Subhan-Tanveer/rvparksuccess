// Session handling for the two admin roles:
//   - 'super-admin': you — can create new parks and set their staff logins
//   - 'park-staff': a specific park's staff — scoped to that one park's data
//
// Sessions are signed JWTs stored in an httpOnly cookie (never readable by
// page JavaScript, so an XSS bug can't steal a login the way it could with
// a token kept in localStorage). Requires ADMIN_SESSION_SECRET to be set —
// see the README for setup. NEVER put that secret's value in any file in
// this repo; it's read from process.env only.
import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'rvps_admin_session';
const SESSION_DAYS = 7;

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set — see README for setup');
  return secret;
}

export function createSessionCookie({ role, parkId = null }) {
  const token = jwt.sign({ role, parkId }, getSecret(), { expiresIn: `${SESSION_DAYS}d` });
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export function getSession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null; // expired or tampered — treat as logged out
  }
}

// Call at the top of any admin API route. Throws a Response-shaped error
// object the route can send straight back; keeps every protected route's
// auth check to one line.
export function requireSession(req, res, { role } = {}) {
  const session = getSession(req);
  if (!session || (role && session.role !== role)) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return session;
}
