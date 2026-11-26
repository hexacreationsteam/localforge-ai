import { handleHealth } from './_lib/ai';

export const config = { runtime: 'edge' };

export default async function handler(_req: Request): Promise<Response> {
  return handleHealth();
}
