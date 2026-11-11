// Cloudflare Pages Function for /s/* (link previews). See pages/sharePreview.ts.
import { sharePreview } from "../../pages/sharePreview";
import { UPSTREAM } from "../../pages/upstream.gen";

export const onRequest = ({ request, next }: { request: Request; next: () => Promise<Response> }): Promise<Response> => sharePreview(request, next, UPSTREAM);
