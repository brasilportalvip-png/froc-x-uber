import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { apiImageUrl } from '../lib/session.ts';

/** Foto de perfil protegida (só quem tem viagem com a pessoa vê). `version` força recarregar depois de trocar. */
export const ProfilePhoto: React.FC<{ uid?: string; size?: number; version?: string; alt?: string; className?: string }> = ({ uid, size = 48, version = '', alt = 'Foto', className = '' }) => {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    let made = '';
    apiImageUrl(`/api/photos/${encodeURIComponent(uid)}?v=${encodeURIComponent(version)}`)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
      })
      .catch(() => alive && setUrl(''));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [uid, version]);
  const box = { width: size, height: size };
  return url ? (
    <img src={url} alt={alt} style={box} className={`rounded-full object-cover shrink-0 ${className}`} />
  ) : (
    <span style={box} className={`rounded-full bg-slate-200 dark:bg-slate-800 inline-flex items-center justify-center shrink-0 ${className}`} aria-label={alt}>
      <User className="w-1/2 h-1/2 text-slate-500" />
    </span>
  );
};
