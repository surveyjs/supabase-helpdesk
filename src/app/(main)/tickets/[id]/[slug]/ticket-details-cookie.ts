/**
 * Cookie remembering a collapsed ticket details panel (#114). Read by the
 * server page, written by TicketDetailsPanel. Kept out of the 'use client'
 * module: a server component importing a value from one gets a client
 * reference, not the string.
 */
export const TICKET_DETAILS_COLLAPSED_COOKIE = 'hd_ticket_details_collapsed';
