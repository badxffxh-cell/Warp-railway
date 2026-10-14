import { HttpError } from './security.js';

// Never expose provider response bodies, URLs, tokens or nested error messages.
export function voiceFailure(error: unknown): HttpError {
  const e = error as { status?: number; code?: string; name?: string; cause?: { code?: string } } | null;
  if (e?.status === 401 || e?.status === 403 || ['unauthenticated', 'permission_denied'].includes(e?.code ?? ''))
    return new HttpError(502, 'LIVEKIT_AUTH', 'O LiveKit recusou as credenciais. Confira API Key e API Secret do mesmo projeto no Render e faça redeploy.');
  if (e?.status === 404)
    return new HttpError(502, 'LIVEKIT_ADDRESS', 'O endereço do LiveKit não foi encontrado. Use o Project URL wss:// do projeto, sem caminhos adicionais.');
  if (e?.status === 429 || e?.code === 'resource_exhausted')
    return new HttpError(503, 'LIVEKIT_LIMIT', 'O LiveKit informou um limite de uso. Confira os limites do projeto no painel LiveKit Cloud.');
  if (['TimeoutError', 'AbortError'].includes(e?.name ?? '') || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(e?.cause?.code ?? ''))
    return new HttpError(504, 'LIVEKIT_TIMEOUT', 'O LiveKit demorou para responder. Tente novamente e confira a disponibilidade do projeto.');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(e?.cause?.code ?? '') || e?.name === 'TypeError')
    return new HttpError(502, 'LIVEKIT_CONNECTION', 'A API não conseguiu conectar ao LiveKit. Confira o Project URL e a disponibilidade do serviço.');
  return new HttpError(502, 'LIVEKIT_SERVICE', 'Falha ao consultar o LiveKit. Confira o endereço, as credenciais do projeto e o status do serviço.');
}

export async function voiceRequest<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw voiceFailure(error); }
}
