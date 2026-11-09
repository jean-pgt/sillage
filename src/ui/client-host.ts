// Adresse que les postes utilisent pour joindre les partages (IP locale ou nom DNS local).
// Par défaut, celle que Sillage utilise en SSH ; réglable par serveur dans « Serveurs ».
export const CLIENT_HOST = /^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/

export function clientHost(server: { host: string; client_host?: string | null }) {
  return server.client_host || server.host
}
