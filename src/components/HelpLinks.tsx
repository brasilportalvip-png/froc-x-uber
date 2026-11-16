import React from 'react';
import { BookOpen, Info, Scale, Terminal } from 'lucide-react';

const LINKS = [
  { href: '/como-funciona', label: 'Como funciona', hint: 'Corridas, caronas, fretes e entregas, passo a passo', Icon: BookOpen },
  { href: '/regras-e-requisitos', label: 'Regras e leis', hint: 'EAR na CNH, ano do veículo, documentos, gravação', Icon: Scale },
  { href: '/perguntas-frequentes', label: 'Perguntas frequentes', hint: 'Respostas rápidas para as dúvidas mais comuns', Icon: Info },
  { href: '/desenvolvedores', label: 'Para lojas e sistemas', hint: 'Integre sua loja e chame entregas automáticas', Icon: Terminal },
];

/** Atalhos para as páginas de ajuda e regras (as mesmas que a Froc IA usa para responder). */
export const HelpLinks: React.FC = () => (
  <div className="rounded-2xl bg-white dark:bg-[#111013] border border-slate-200 dark:border-slate-800 p-4 space-y-2">
    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Ajuda, regras e leis</h4>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {LINKS.map(({ href, label, hint, Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-emerald-500 transition"
        >
          <Icon className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
          <span className="min-w-0">
            <span className="block text-xs font-bold text-slate-900 dark:text-white">{label}</span>
            <span className="block text-[11px] text-slate-500">{hint}</span>
          </span>
        </a>
      ))}
    </div>
  </div>
);
