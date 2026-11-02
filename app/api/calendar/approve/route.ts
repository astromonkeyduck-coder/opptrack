import { calendarWritePost } from '../../../../lib/calendar/write-route';
export const runtime = 'nodejs';
export async function POST(request: Request) { return calendarWritePost(request, false); }
