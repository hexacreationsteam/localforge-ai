import { handleMega } from '../../_lib/ai';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  return handleMega(req);
}
