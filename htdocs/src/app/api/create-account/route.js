// Antes: criava "contas de jogo" à parte da conta do site. Agora a conta do site já é a conta do jogo (cadastro em /api/register).
export async function POST() {
  return Response.json({ error: 'Crie sua conta pela página de cadastro.' }, { status: 410 })
}
