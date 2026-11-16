# Auditoria de produção — Froc X Uber (16/11/2026)

## Como foi feito
- **180 testes automáticos** rodando as regras de verdade (mesmo código do servidor), com o banco de testes imitando
  o Firestore — inclusive a regra do Firestore de "ler tudo antes de gravar" dentro de cada transação.
- **Jornada completa** (`tests/jornada.test.ts`): 6 pessoas usando o app como em produção — CPF, recargas, cadastro de
  motorista lido e aprovado pela IA, carros no mapa, corrida com espera, link de acompanhamento, gravação, avaliação,
  cancelamento com taxa, negociação, carona, frete, loja com entrega por código, saque liberado pela Equipe IA, bloqueio.
  **Depois de cada passo, a lei do dinheiro é conferida**: recargas + bônus = saldos + valores retidos + ganho da Froc +
  saques. Nenhum centavo some ou aparece do nada.
- **Ataques** (`tests/seguranca.test.ts`): cliques simultâneos (pedir, finalizar, cancelar, sacar e confirmar recarga ao
  mesmo tempo), valores inválidos (negativos, zero, texto, gigantes, fora do Brasil), mexer no que é dos outros, funções de
  administração por usuário comum, admin sem e-mail confirmado, conta bloqueada.
- **Revisão de rotas e código**: todas as rotas `/api/*` exigem login; todas as de administração conferem admin no
  servidor; API das lojas exige chave; páginas públicas escapam texto; sem segredos no repositório.

## Corrigido nesta rodada
| Achado | Risco | Correção |
|---|---|---|
| `/api/health` público mostrava detalhes internos (projeto, prefixo, saúde da IA) | Informação para atacante | Público só mostra sim/não; detalhes em `/api/admin/health` (só admin) |
| `/api/client-error` sem teto global | Lotar o banco com erros falsos | Teto de 3.000 por dia |
| Rotinas da Equipe IA (saques, lojas) podiam rodar dentro do carregamento da tela | Tela lenta (consulta externa de até 8 s) | Agora rodam só no agendador |
| Motorista não era avisado de corrida nova com o app minimizado | Perder corridas | Som + vibração + notificação do navegador (nova corrida, motorista aceitou, chegou, nova mensagem) |
| Ferramenta "áreas de risco" da IA devolvia vazio (propriedade duplicada) | Agente sem dados | Corrigida e coberta por teste |

## Resultado por área
- **Dinheiro:** transações atômicas, valores em centavos, pagamento só pela carteira, retenção até o fim, estornos,
  taxas de cancelamento/espera, ganho fixo da Froc, saque só de ganhos. Lei do dinheiro fechando em todas as etapas. ✅
- **Permissões:** passageiro, motorista, loja, admin e agentes separados no servidor. ✅
- **Identidade:** CPF obrigatório, 1 conta por pessoa, CPF bloqueado com a conta, CPF completo fora do cadastro público,
  acesso da equipe ao CPF auditado. ✅
- **Concorrência:** pedir, finalizar, cancelar e sacar ao mesmo tempo não duplicam dinheiro. ✅
- **Privacidade:** link de acompanhamento sem telefone/valores, carros no mapa com posição deslocada e id anônimo,
  gravação só no celular. ✅

## O que NÃO dá para garantir daqui (precisa de você)
1. **Regras do Firestore e do Storage do projeto Firebase** (são compartilhadas com o outro app). O Froc não usa o
   Firestore pelo navegador, então as coleções `froc_*` e a pasta `froc-x-uber/` do Storage **não podem ter permissão
   de leitura para usuários logados**. Se as regras tiverem algo como `match /{document=**} { allow read: if request.auth != null; }`,
   qualquer pessoa logada leria CPFs e documentos. Confira no console do Firebase (Firestore → Regras e Storage → Regras)
   e mande o texto das regras para revisão.
2. **Mercado Pago configurado** (`MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET`): sem dinheiro na mão,
   sem recarga ninguém pede corrida. O `/api/health` mostra `mercadoPago: true` quando está certo.
3. **Agendador (cron) chamando `/api/cron/sweep` a cada 5 min** com o `CRON_SECRET`: é ele que roda a Equipe IA
   (cadastros, saques, lojas, prazos, webhooks).
4. **Build e teste no navegador** rodam no seu computador pelo instalador (`npm run build`, `npm run e2e`) e no site no
   ar (`TESTAR_PRODUCAO.cmd`).
5. **Envio automático de Pix**: depende de liberar o Payouts na conta Mercado Pago.

## Riscos conhecidos e aceitos
- O navegador só grava áudio/vídeo com o app aberto; avisos com o celular bloqueado precisam de push (próxima etapa).
- GPS falso no celular do motorista não é detectável pelo site.
- Webhook das lojas: bloqueia endereços internos, mas não protege contra DNS que muda depois da conferência.
- CSP está em modo "só relatório" (não bloqueia); ligar o bloqueio depois de 1 semana sem relatórios de erro.
- Um passageiro com saldo para duas corridas que tocar duas vezes muito rápido pode abrir dois pedidos (cancelamento
  grátis antes do aceite); o botão já fica travado enquanto envia.
