import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxList, type InboxRow } from "../app/inbox/components";

const proof = JSON.parse(await readFile("private/stage-1-inbox-rows.json", "utf8")) as { rows: InboxRow[] };
if (!proof.rows?.length) throw new Error("No genuine RLS-selected live rows; refusing to render a substitute inbox");
const central = proof.rows.filter(row => row.source_id === "fsu-calendar-api").slice(0, 5);
const independent = proof.rows.filter(row => row.source_id === "fsu-music-events").slice(0, 2);
const rows = [...central, ...independent];
const css = await readFile("app/globals.css", "utf8");
const markup = renderToStaticMarkup(createElement(InboxList, { rows }));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stage 1 live inbox evidence</title><style>${css}</style><body><main class="inbox-shell"><header><span class="wordmark"><span class="mark">F</span>Opportunity Tracker</span><span>Local evidence</span></header><section class="inbox-intro"><p class="eyebrow">Fresh live source facts · actual PostgreSQL</p><h1>Your review inbox</h1><p class="lead">${proof.rows.length} actual occurrences read through the owner RLS policy. A sample from both sources appears below using the application’s inbox component.</p><p class="notice">Local PostgreSQL evidence rendering. Supabase Auth/Storage HTTP and Trigger Cloud execution are not verified here. This is a static evidence page with no actions or auth bypass in the application.</p><p class="approval">Calendar writes disabled · Ticket availability unverified · HQ member and social coverage unconfigured</p></section>${markup}</main></body></html>`;
await writeFile("private/stage-1-inbox.html", html, { mode: 0o600 });
console.log(`Rendered ${rows.length} genuine occurrences from ${proof.rows.length} RLS-selected rows to ignored private/stage-1-inbox.html; hosted authentication remains unverified.`);
