// Cloudflare Pages Function for /api/*. `upstream.gen.ts` is written by scripts/render-pages.mjs during deploy
// (gitignored), the same way vercel.json used to carry the Supabase project ref.
import { proxy } from "../../pages/proxy";
import { UPSTREAM } from "../../pages/upstream.gen";

export const onRequest = ({ request }: { request: Request }): Promise<Response> => proxy(request, UPSTREAM);
