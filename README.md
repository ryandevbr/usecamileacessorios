# Use Camile Acessórios

Vitrine online da **Use Camile Acessórios** (Prata 925 e Semijoias), com catálogo filtrável, detalhes compartilháveis de peças, sacola de compras, aplicação de cupons, finalização de pedido via WhatsApp e painel administrativo.

## Stack utilizada

- **Framework / SSR:** [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) + [TanStack Query](https://tanstack.com/query)
- **Interface:** React 19, TypeScript, Tailwind CSS v4, Radix UI / shadcn/ui, Lucide Icons, Sonner
- **Build e Servidor:** Vite 8, Nitro
- **Testes e Qualidade:** Vitest, Testing Library, ESLint, Prettier

## Rotas principais

- `/` — Vitrine pública com banners, filtros, busca, ordenação, detalhes do produto, sacola, cupons e envio de pedido pelo WhatsApp
- `/login` — Acesso ao painel administrativo
- `/admin` — Painel de gestão de produtos, banners, barra de avisos, cupons e perfil da administradora

## Pré-requisitos

- **Node.js** 20+ (recomendado v22 ou v24)
- **npm** 10+

## Instalação

```bash
npm install
```

## Configuração de variáveis de ambiente (`.env`)

Para integrar a aplicação ao **Supabase**, crie um arquivo `.env` na raiz do projeto com as credenciais do seu projeto:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
```

> **Observação:** Atualmente o catálogo, banners, avisos e cupons operam em modo demonstração local (`localStorage` / `sessionStorage`) até a ativação da integração externa com o Supabase.

## Banco de dados (`supabase/schema.sql`)

Ao configurar o banco de dados no Supabase:

1. Acesse o painel do seu projeto no [Supabase](https://supabase.com/dashboard).
2. Abra **SQL Editor** → **New query**.
3. Copie e execute o conteúdo do arquivo `supabase/schema.sql` (ou aplique via Supabase CLI com `supabase db push` / `psql`).
4. Confirme que as tabelas, políticas de RLS e buckets de storage foram criados corretamente e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no arquivo `.env`.

## Comandos disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento em `http://localhost:8080` |
| `npm run build` | Gera o build de produção (cliente + servidor) |
| `npm run preview` | Visualiza localmente o build de produção |
| `npm test` | Executa a suíte de testes com Vitest |
| `npm run test:watch` | Executa os testes em modo watch |
| `npm run lint` | Verifica problemas de lint com ESLint |
| `npm run format` | Formata o código com Prettier |
| `npx tsc --noEmit` | Executa a checagem de tipos do TypeScript |
