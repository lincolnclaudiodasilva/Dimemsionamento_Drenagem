# Dimensionamento de Drenagem — Como executar localmente

Este app é um componente React (`DrainageApp.jsx`). Ele precisa de um projeto
React com Vite + Tailwind CSS + lucide-react para funcionar fora do Claude.

## Passo a passo (primeira vez)

```bash
# 1. Criar o projeto Vite
npm create vite@latest drenagem-mina -- --template react
cd drenagem-mina

# 2. Instalar dependências do app
npm install lucide-react

# 3. Instalar e configurar Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

No arquivo `tailwind.config.js`, garanta que `content` aponte para os arquivos do projeto:

```js
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

No arquivo `src/index.css`, adicione no topo:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Colocar o app no projeto

1. Copie `DrainageApp.jsx` para `src/DrainageApp.jsx`
2. No `src/App.jsx`, substitua o conteúdo por:

```jsx
import DrainageApp from "./DrainageApp";

export default function App() {
  return <DrainageApp />;
}
```

3. Garanta que `src/main.jsx` importa o `index.css` (já vem assim por padrão no Vite).

## Rodar

```bash
npm run dev
```

Abre em `http://localhost:5173` — funciona offline a partir daí (sem precisar de
internet, exceto para o ícone Inter/JetBrains Mono via Google Fonts, que pode ser
removido do CSS embutido no componente se quiser 100% offline).

## Build para uso permanente (sem precisar do `npm run dev` toda vez)

```bash
npm run build
```

Isso gera a pasta `dist/` com HTML+JS+CSS finais. Você pode abrir o
`dist/index.html` direto no navegador (ou hospedar em qualquer servidor estático).

## Observações

- O app guarda todos os dados em memória (estado React) — fechar a aba apaga os
  dados. Se quiser persistência entre sessões, posso adicionar salvamento em
  arquivo local (ex. exportar/importar um JSON com todas as regiões) em vez de
  depender só do CSV final.
- A exportação de relatório já funciona via botão "Exportar CSV" dentro do app,
  sem depender de nenhum pacote adicional.
