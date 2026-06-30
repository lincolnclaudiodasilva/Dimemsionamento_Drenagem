# Drenagem Mineração — Dimensionamento Hidráulico

PWA para dimensionamento de canais trapezoidais, tubos corrugados PEAD, bacias de sedimentação, dissipadores de energia, valetas de crista e sarjetas de pista, com geração de memorial descritivo. Desenvolvido para uso em mineração a céu aberto.

## Como publicar no GitHub Pages

Como você já publica no `lincolnclaudiodasilva.github.io`, o caminho mais rápido é criar um novo repositório e ativar o Pages:

### 1. Criar o repositório
No GitHub, crie um repositório novo, por exemplo `drenagem-mineracao`.

### 2. Enviar os arquivos
No terminal, dentro da pasta `drenagem-mineracao` (a que contém `index.html`, `manifest.json`, `service-worker.js` e a pasta `icons/`):

```bash
git init
git add .
git commit -m "Primeira versão do app de drenagem"
git branch -M main
git remote add origin https://github.com/lincolnclaudiodasilva/drenagem-mineracao.git
git push -u origin main
```

### 3. Ativar o GitHub Pages
No repositório, vá em **Settings → Pages**, em "Source" selecione a branch `main` e a pasta `/ (root)`. Salve.

Em alguns minutos o app estará disponível em:
```
https://lincolnclaudiodasilva.github.io/drenagem-mineracao/
```

### 4. Instalar no celular ou desktop
Ao abrir o link no Chrome (Android) ou Safari (iOS), aparecerá a opção de instalar o app na tela inicial (ou o banner "Instalar" no topo da página, se o navegador suportar). Uma vez instalado, o app funciona offline graças ao service worker.

## Estrutura de arquivos

```
drenagem-mineracao/
├── index.html          # aplicativo completo (todos os módulos)
├── manifest.json        # configuração do PWA (nome, ícone, cores)
├── service-worker.js    # cache offline
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## Módulos incluídos

- **Método racional** — vazão de pico (Q = C·i·A/360) com tempo de concentração por Kirpich
- **Canal trapezoidal** — dimensionamento por Manning com verificação de velocidade erosiva
- **Tubo corrugado PEAD** — seleção de diâmetro comercial (DN 300–2000mm)
- **Bacia de sedimentação** — critérios de Stokes e tempo de detenção
- **Dissipador de energia** — bacia de amortecimento (ressalto), enrocamento, degraus
- **Valeta de crista** — dimensionamento e posicionamento em relação ao talude
- **Sarjeta de pista** — vias de acesso de mina, seção triangular
- **Memorial descritivo** — geração de relatório consolidado, com opção de impressão/PDF

## Atualizando o app depois de publicado

Sempre que editar `index.html` (ou outro arquivo), suba a alteração e **troque o nome do `CACHE_NAME`** em `service-worker.js` (ex.: `v1` → `v2`) para forçar os usuários a buscarem a versão nova em vez de usar o cache antigo.

```bash
git add .
git commit -m "Atualização do app"
git push
```
