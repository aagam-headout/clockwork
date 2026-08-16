/*
 * The timezone picker's options, shared by the workflow form and the
 * account-level default.
 *
 * A fixed list rather than `Intl.supportedValuesOf("timeZone")`: that returns
 * whatever ICU the runtime shipped with, so Node and the browser can disagree
 * and cause hydration mismatches. These cover every common offset; the
 * workflow form splices a saved value in if it's missing.
 *
 * Its own module, not an export off the form: the form is `"use client"`, and
 * every export of a client module reaches server code as a client reference
 * rather than the value itself — reading `.includes`/`.map` off it in a
 * server component or a server action throws at run time.
 */
export const TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Anchorage",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/** The zone a workflow gets when neither it nor the account names one. */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";
