import { hashPassword, verifyPassword } from './password.js';
import { readDB, writeDB } from './db.js';

export function createParkAccount({ parkName, location, ownerName, email, phone, password }) {
  const db = readDB();

  if (!db.parks) db.parks = [];
  if (db.parks.some(p => p.ownerEmail === email)) {
    throw new Error('Email already registered');
  }

  const parkId = 'park_' + Date.now();
  const hashedPassword = hashPassword(password);

  const park = {
    id: parkId,
    name: parkName,
    location,
    ownerName,
    ownerEmail: email,
    ownerPhone: phone,
    passwordHash: hashedPassword,
    createdAt: new Date().toISOString(),
    sites: [],
  };

  db.parks.push(park);
  writeDB(db);

  return park;
}

export function verifyParkOwnerLogin(email, password) {
  const db = readDB();
  if (!db.parks) return null;

  const park = db.parks.find(p => p.ownerEmail === email);
  if (!park) return null;

  const valid = verifyPassword(password, park.passwordHash);
  if (!valid) return null;

  return park;
}

export function getParkByOwnerEmail(email) {
  const db = readDB();
  if (!db.parks) return null;
  return db.parks.find(p => p.ownerEmail === email);
}

export function getParkById(parkId) {
  const db = readDB();
  if (!db.parks) return null;
  return db.parks.find(p => p.id === parkId);
}

export function updateParkSites(parkId, sites) {
  const db = readDB();
  const park = db.parks.find(p => p.id === parkId);
  if (!park) throw new Error('Park not found');

  park.sites = sites;
  writeDB(db);

  return park;
}

export function addParkSite(parkId, site) {
  const db = readDB();
  const park = db.parks.find(p => p.id === parkId);
  if (!park) throw new Error('Park not found');

  const siteId = 'site_' + Date.now();
  const newSite = { id: siteId, ...site };
  park.sites.push(newSite);
  writeDB(db);

  return newSite;
}

export function getParkBookings(parkId) {
  const db = readDB();
  if (!db.reservations) return [];

  return db.reservations.filter(r => r.parkId === parkId);
}
