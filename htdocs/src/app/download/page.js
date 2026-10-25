import { redirect } from 'next/navigation'

// O jogo agora roda no navegador: o antigo download do cliente leva direto ao jogo.
export default function DownloadPage() {
  redirect('/game/')
}
