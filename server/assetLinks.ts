/** Conteúdo do assetlinks.json (vazio enquanto o app Android não estiver configurado). */
export function assetLinks(packageName?: string, sha256?: string) {
  const pkg = String(packageName || '').trim();
  const prints = String(sha256 || '')
    .split(/[\s,;]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) || !prints.length) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [...new Set(prints)] },
    },
  ];
}
