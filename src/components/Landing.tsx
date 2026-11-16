import React, { useEffect, useState } from 'react';
import { ArrowRight, Car, ChevronDown, HandCoins, Shield, ShieldCheck, Sparkles, Star, Truck, Users, Wallet } from 'lucide-react';
import { AuthScreen } from './AuthScreen.tsx';
import { LaunchCountdown, LaunchPopup } from './LaunchPopup.tsx';
import { LAUNCH_LABEL, SHARE_TEXT, saveIntent, type SignupIntent } from '../lib/launch.ts';

const SERVICES = [
  { icon: Car, title: 'Corridas', text: 'Peça um carro ou moto na hora, com preço calculado antes e PIN de segurança no embarque.' },
  { icon: HandCoins, title: 'Negociar', text: 'Você propõe o valor da corrida e os motoristas da região respondem com ofertas.' },
  { icon: Users, title: 'Caronas', text: 'Viagens entre cidades de todo o Brasil dividindo o custo com quem vai pro mesmo destino.' },
  { icon: Truck, title: 'Cargas e fretes', text: 'Caminhões, vans, furgões e utilitários: mudança, carreto e frete de retorno mais barato.' },
];

const FAQ = [
  ['O Froc X Uber funciona em que cidades?', 'Em todo o Brasil. Corridas e negociação funcionam em qualquer endereço; caronas e fretes ligam qualquer cidade do país.'],
  ['Como funciona o pagamento?', 'Tudo pela carteira Froc: você recarrega por Pix ou cartão (Mercado Pago) e paga com o saldo. Não existe dinheiro na mão, o que acaba com golpes de troco e de cobrança por fora. O valor fica guardado pela Froc e vai para o motorista quando a viagem termina.'],
  ['Como faço para ser motorista ou cadastrar meu veículo de carga?', 'Crie sua conta, escolha Motorista ou Caminhoneiro, envie CNH, documento do veículo (e RNTRC para frete) e aguarde a aprovação da equipe.'],
  ['É seguro?', 'Todo motorista passa por análise de documentos, o embarque usa PIN, há botão SOS com localização, avaliação dos dois lados e atendimento pela equipe Froc.'],
  ['Quando é a inauguração?', `A grande inauguração é em ${LAUNCH_LABEL}. Quem se cadastra antes ganha o selo de membro fundador.`],
];

/** Página inicial pública: apresentação, chamadas para ação, contagem regressiva e login. */
export const Landing: React.FC<{ configError?: string | null }> = ({ configError }) => {
  const [modeRequest, setModeRequest] = useState<{ mode: 'login' | 'signup'; at: number } | null>(null);
  // A vitrine é sempre preta (identidade Froc), mesmo para quem usa o app no tema claro.
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => {
      let light = false;
      try {
        light = localStorage.getItem('froc-theme') === 'light';
      } catch {
        /* sem armazenamento */
      }
      if (light) document.documentElement.classList.remove('dark');
    };
  }, []);

  const goSignup = (intent: SignupIntent = 'passenger') => {
    saveIntent(intent);
    setModeRequest({ mode: 'signup', at: Date.now() });
    document.getElementById('entrar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goLogin = () => {
    setModeRequest({ mode: 'login', at: Date.now() });
    document.getElementById('entrar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-transparent text-white">
      <LaunchPopup onSignup={() => goSignup('passenger')} />

      <header className="sticky top-0 z-30 backdrop-blur-md bg-black/70 border-b border-white/10">
        <div className="max-w-6xl mx-auto h-14 px-4 flex items-center justify-between gap-3">
          <a href="/" className="font-display text-xl font-extrabold froc-logo">
            Froc X Uber
          </a>
          <nav className="flex items-center gap-2 text-xs font-semibold">
            <a href="/blog" className="hidden sm:inline px-3 py-2 text-slate-300 hover:text-white">Blog</a>
            <button type="button" onClick={goLogin} className="px-3 py-2 text-slate-200 hover:text-white cursor-pointer">Entrar</button>
            <button type="button" onClick={() => goSignup('passenger')} className="px-4 min-h-[38px] rounded-xl bg-emerald-600 text-white cursor-pointer">
              Criar conta grátis
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* Herói */}
        <section className="relative overflow-hidden">
          <span className="froc-sparkle" style={{ top: '18%', left: '8%' }} />
          <span className="froc-sparkle" style={{ top: '30%', right: '10%', animationDelay: '1.1s' }} />
          <span className="froc-sparkle" style={{ bottom: '20%', left: '45%', animationDelay: '2s' }} />
          <div className="max-w-6xl mx-auto px-4 pt-12 pb-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
            <div className="space-y-6 froc-enter">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-300">
                <Sparkles className="w-3.5 h-3.5" /> Inauguração em {LAUNCH_LABEL}
              </div>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05]">
                Corridas, caronas e fretes.
                <span className="block froc-logo">Tudo no Froc X Uber.</span>
              </h1>
              <p className="text-base sm:text-lg text-slate-300 max-w-xl">
                O app 4 em 1 do Brasil: peça uma corrida, negocie o preço, divida uma viagem entre cidades ou contrate caminhão, van e utilitário — com pagamento protegido e atendimento de verdade.
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => goSignup('passenger')} className="inline-flex items-center gap-2 px-6 min-h-[52px] rounded-2xl bg-emerald-600 text-white font-bold cursor-pointer froc-pulse-pink">
                  Criar conta grátis <ArrowRight className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => goSignup('driver')} className="inline-flex items-center gap-2 px-6 min-h-[52px] rounded-2xl bg-amber-500 font-bold cursor-pointer">
                  Quero ser motorista
                </button>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Motoristas verificados</span>
                <span className="inline-flex items-center gap-1.5"><Wallet className="w-4 h-4 text-amber-400" /> Pix e cartão pelo Mercado Pago</span>
                <span className="inline-flex items-center gap-1.5"><Shield className="w-4 h-4 text-emerald-400" /> Botão SOS</span>
              </div>
            </div>
            <div className="froc-frame froc-float">
              <div className="bg-[#0b0b0c] p-6 space-y-4">
                <div className="text-sm font-bold text-slate-200">Faltam para a inauguração</div>
                <LaunchCountdown />
                <p className="text-xs text-slate-400">Cadastre-se antes e ganhe o selo de <strong className="text-amber-300">membro fundador</strong> na sua conta.</p>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(SHARE_TEXT)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center w-full min-h-[44px] leading-[44px] rounded-xl border border-amber-500/60 text-amber-200 text-sm font-semibold"
                >
                  Avisar meus amigos no WhatsApp
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Serviços */}
        <section className="max-w-6xl mx-auto px-4 py-10" aria-labelledby="servicos">
          <h2 id="servicos" className="font-display text-2xl sm:text-3xl font-extrabold text-center">
            4 apps em <span className="froc-gold-text">um só</span>
          </h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SERVICES.map(({ icon: Icon, title, text }, i) => (
              <article key={title} className="froc-enter rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3" style={{ animationDelay: `${i * 90}ms` }}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-800 flex items-center justify-center shadow-lg shadow-emerald-900/40">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-display text-lg font-bold">{title}</h3>
                <p className="text-sm text-slate-400">{text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Chamadas para quem trabalha */}
        <section className="max-w-6xl mx-auto px-4 py-6 grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/60 to-black p-6 space-y-3">
            <h2 className="font-display text-xl font-extrabold">Dirija com o Froc</h2>
            <p className="text-sm text-slate-300">Carro ou moto: receba corridas perto de você, negocie preços e ofereça caronas entre cidades. O pagamento cai na sua carteira ao fim de cada viagem.</p>
            <button type="button" onClick={() => goSignup('driver')} className="px-5 min-h-[46px] rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
              Cadastrar como motorista
            </button>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/50 to-black p-6 space-y-3">
            <h2 className="font-display text-xl font-extrabold">Tem caminhão, van ou utilitário?</h2>
            <p className="text-sm text-slate-300">Anuncie sua volta vazia, receba pedidos de mudança e carreto e dê lances nos fretes. Vale caminhão, van, furgão, pick-up e utilitário.</p>
            <button type="button" onClick={() => goSignup('trucker')} className="px-5 min-h-[46px] rounded-xl bg-amber-500 font-bold cursor-pointer">
              Cadastrar meu veículo de carga
            </button>
          </div>
        </section>

        {/* Login / cadastro */}
        <section id="entrar" className="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-2 gap-8 items-start scroll-mt-20">
          <div className="space-y-4">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold">
              Entre ou crie sua conta <span className="froc-gold-text">em 1 minuto</span>
            </h2>
            <ul className="space-y-2 text-sm text-slate-300">
              {['Conta grátis para passageiros', 'Entre com Google ou e-mail', 'Mesma conta para corridas, caronas e fretes', 'Atendimento da equipe Froc dentro do app'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="froc-frame">
            <div className="bg-[#0b0b0c] p-1">
              <AuthScreen configError={configError} embedded modeRequest={modeRequest} />
            </div>
          </div>
        </section>

        {/* Perguntas frequentes */}
        <section className="max-w-3xl mx-auto px-4 py-10" aria-labelledby="faq">
          <h2 id="faq" className="font-display text-2xl font-extrabold text-center mb-6">Perguntas frequentes</h2>
          <div className="space-y-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none font-semibold text-sm">
                  {q}
                  <ChevronDown className="w-4 h-4 text-amber-400 transition-transform group-open:rotate-180" />
                </summary>
                <p className="pt-2 text-sm text-slate-400">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8 px-4 text-center text-xs text-slate-500 space-y-2">
        <div className="flex flex-wrap justify-center gap-4">
          <a href="/blog" className="hover:text-white">Blog</a>
          <a href="/como-funciona" className="hover:text-white">Como funciona</a>
          <a href="/regras-e-requisitos" className="hover:text-white">Regras e leis</a>
          <a href="/perguntas-frequentes" className="hover:text-white">Perguntas frequentes</a>
          <a href="/desenvolvedores" className="hover:text-white">Para lojas</a>
          <a href="/legal/ajuda.html" className="hover:text-white">Ajuda</a>
          <a href="/legal/seguranca.html" className="hover:text-white">Segurança</a>
          <a href="/legal/termos.html" className="hover:text-white">Termos</a>
          <a href="/legal/privacidade.html" className="hover:text-white">Privacidade</a>
        </div>
        <div>© {new Date().getFullYear()} Froc X Uber</div>
      </footer>
    </div>
  );
};
