<div align="center">

# IdeaGold

### Nimbus Hash Router — Cloud Mining Intelligence

**Protótipo de inteligência client-side para análise de rentabilidade, risco e alocação de hashrate em mineração SHA-256.**

![Status](https://img.shields.io/badge/status-prot%C3%B3tipo-6d8cff?style=for-the-badge)
![HTML5](https://img.shields.io/badge/HTML5-interface-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-responsivo-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111)
![License](https://img.shields.io/badge/licen%C3%A7a-propriet%C3%A1ria-111827?style=for-the-badge)

[Visão geral](#-visão-geral) • [Funcionalidades](#-funcionalidades) • [Como funciona](#-como-funciona) • [Arquitetura](#-arquitetura) • [Roadmap](#-roadmap) • [Direitos autorais](#-direitos-autorais)

</div>

---

## 💡 Visão geral

**IdeaGold** é o repositório de um experimento de software atualmente apresentado na interface como **Nimbus Hash Router**.

O projeto explora uma ideia simples: transformar parâmetros técnicos de mineração SHA-256 em uma visão operacional mais clara para quem precisa avaliar um cenário de hashrate contratado.

Em vez de apenas exibir números isolados, o protótipo combina:

- estimativa probabilística de produção de BTC;
- receita bruta estimada;
- custo diário do contrato de mineração em nuvem;
- lucro ou prejuízo líquido estimado;
- margem operacional;
- break-even de custo por TH/s/dia;
- comparação de diferentes perfis de pool;
- penalização heurística por risco e variância;
- sugestão de distribuição do hashrate;
- projeção acumulada de 30 dias;
- consulta opcional a dados públicos de mercado e rede;
- exportação local do cenário analisado em JSON.

O objetivo do projeto é **apoio à análise e experimentação**. Ele não minera Bitcoin no navegador, não administra fundos, não movimenta ativos e não promete rentabilidade.

---

## 🎯 Problema que o projeto procura resolver

Ao avaliar mineração em nuvem ou a alocação de hashrate, vários fatores precisam ser observados ao mesmo tempo:

- hashrate contratado;
- custo do contrato;
- preço do BTC;
- dificuldade da rede;
- recompensa por bloco;
- disponibilidade do serviço;
- taxas de pool;
- custo de saque;
- volatilidade/variância do modelo de pagamento;
- risco de concentrar todo o hashrate em uma única estratégia.

O IdeaGold/Nimbus organiza esses elementos em um único painel e recalcula o cenário no próprio navegador.

---

## ✨ Funcionalidades

### Motor de rentabilidade

O painel permite informar:

| Parâmetro | Finalidade |
|---|---|
| Hashrate contratado | Potência contratada em TH/s |
| Custo do contrato | Custo em US$/TH/dia |
| Preço do BTC | Conversão da produção estimada para USD |
| Dificuldade da rede | Base para estimar a probabilidade de produção |
| Recompensa por bloco | Quantidade de BTC considerada por bloco |
| Uptime esperado | Ajuste da capacidade efetivamente disponível |
| Taxa de saque | Custo operacional diário adicional |
| Reserva de risco | Peso aplicado à penalização de variância |

A partir desses dados, o sistema apresenta:

- **receita estimada por dia**;
- **produção estimada de BTC por dia**;
- **lucro líquido diário**;
- **margem estimada**;
- **custo máximo aproximado para break-even**.

### Roteador de pools

O protótipo possui quatro perfis locais de comparação:

- **PPS+ Estável**;
- **FPPS Baixa Taxa**;
- **PPLNS Agressivo**;
- **Solo-Hedge**.

Cada perfil possui uma taxa e um valor de variância usados pelo motor local para gerar um **score comparativo**.

> Esses nomes representam perfis/modelos de simulação do protótipo. Eles não devem ser interpretados como integração ou recomendação oficial de um pool específico.

### Heurística “Nimbus Spread”

Depois de classificar os perfis, a interface seleciona as duas melhores opções segundo o score calculado e sugere uma divisão aproximada de hashrate.

A distribuição parte de **75% / 25%** e pode evoluir para **90% / 10%** ou **100% / 0%** quando a vantagem do primeiro colocado aumenta.

A intenção é demonstrar uma estratégia de hedge simples: quando a diferença entre duas alternativas é pequena, evitar concentração total pode reduzir exposição a variação de recompensa, downtime e diferenças de payout.

### Projeção de 30 dias

O projeto desenha, por meio de `canvas`, uma curva acumulada de 30 dias baseada no resultado líquido diário do cenário atual.

A projeção é deliberadamente simples e **não considera reinvestimento automático**.

### Atualização de dados públicos

O botão **Atualizar dados públicos** tenta consultar:

- **CoinGecko API** — preço do Bitcoin em USD;
- **mempool.space API** — dificuldade atual da rede Bitcoin.

As chamadas são realizadas diretamente pelo navegador e podem depender de conectividade, disponibilidade das APIs e políticas de CORS.

### Exportação de cenário

O usuário pode exportar os parâmetros atuais para um arquivo JSON contendo os valores utilizados na simulação e o horário de geração.

O arquivo não precisa conter seed phrase, chave privada ou credencial de saque.

---

## 🧮 Como funciona

### 1. Estimativa de produção

O motor converte o hashrate informado em hashes por segundo e utiliza a dificuldade da rede para estimar a expectativa de blocos por dia.

De forma simplificada:

```text
H = hashrate_TH × 10¹²
hashes_por_bloco = dificuldade × 2³²
blocos_por_dia = (H × 86.400) / hashes_por_bloco
BTC_por_dia = blocos_por_dia × recompensa × uptime
```

### 2. Receita bruta

```text
receita_bruta = BTC_por_dia × preço_BTC
```

### 3. Custo do contrato

```text
custo_contrato = hashrate_TH × custo_por_TH_por_dia
```

### 4. Resultado líquido base

```text
resultado_líquido = receita_bruta - custo_contrato - taxa_de_saque
```

### 5. Break-even

O painel também estima qual seria o custo máximo de contrato por TH/s/dia para o cenário atingir aproximadamente o ponto de equilíbrio.

### 6. Score dos perfis

Para cada perfil de pool, o protótipo considera:

- receita após a fee;
- custo contratado;
- custo de saque;
- uma penalização de variância ponderada pela reserva de risco;
- uma penalização adicional proporcional ao resultado e à variância.

O score serve apenas como **heurística comparativa local**.

---

## 🧱 Arquitetura atual

O protótipo foi concebido para funcionar com baixa complexidade operacional.

```text
IdeaGold
└── index.html
    ├── gerador Python no snapshot atual
    └── HTML gerado
        ├── estrutura da interface
        ├── CSS responsivo
        └── JavaScript client-side
            ├── cálculo de rentabilidade
            ├── ranking de perfis
            ├── Nimbus Spread
            ├── gráfico em Canvas
            ├── chamadas HTTP públicas
            └── exportação JSON
```

### Stack

- **HTML5**
- **CSS3**
- **JavaScript puro (Vanilla JS)**
- **Canvas API**
- **Fetch API**
- **Intl.NumberFormat**
- **Blob / Object URL para exportação local**
- **Python `pathlib` no snapshot atual usado para materializar o HTML**

Não há framework front-end, backend, banco de dados ou sistema de custódia no estado atual do repositório.

---

## 🔐 Segurança e privacidade

O design atual é **client-side** e não precisa receber chaves privadas para realizar os cálculos.

Boas práticas importantes:

- nunca informar **seed phrase**;
- nunca informar **chave privada**;
- não utilizar chave de API com permissão de saque em páginas client-side;
- considerar qualquer dado público obtido por API como sujeito a atraso, indisponibilidade ou erro;
- revisar manualmente valores críticos antes de tomar qualquer decisão financeira;
- manter integrações futuras de credenciais sensíveis exclusivamente em ambiente seguro e controlado.

---

## ⚠️ Aviso sobre mineração e finanças

Este projeto é uma ferramenta **educacional, experimental e operacional de apoio à análise**.

Resultados de mineração podem variar significativamente por causa de:

- dificuldade da rede;
- preço do Bitcoin;
- hashrate efetivo;
- downtime;
- taxas;
- modelo de pagamento do pool;
- políticas do provedor;
- condições do contrato;
- eventos de mercado;
- alterações de protocolo e recompensa.

**Nenhum cálculo exibido pelo IdeaGold/Nimbus constitui promessa de lucro, garantia de retorno, recomendação de investimento ou aconselhamento financeiro.**

---

## 🚀 Estado atual do projeto

O repositório está em fase de **protótipo / prova de conceito**.

No snapshot atual, existe somente o arquivo `index.html`. Apesar do nome, esse arquivo contém um pequeno script Python que armazena a página em uma string e grava o HTML gerado em `/mnt/data/nimbus_hash_router.html`.

Isso significa que a estrutura ainda precisa ser normalizada para uma distribuição web convencional.

### Execução do snapshot atual

Com Python instalado, o arquivo pode ser interpretado como script apesar da extensão:

```bash
python index.html
```

O código tentará gerar:

```text
/mnt/data/nimbus_hash_router.html
```

> Em sistemas que não possuem `/mnt/data`, o caminho deverá ser adaptado antes da execução.

Para uma versão web pronta para GitHub Pages, o próximo passo recomendado é manter o HTML final diretamente no `index.html` da raiz.

---

## 🗺️ Roadmap

### Curto prazo

- [ ] Normalizar `index.html` para HTML executável diretamente no navegador.
- [ ] Separar CSS e JavaScript em arquivos próprios.
- [ ] Adicionar favicon, identidade visual e screenshots do painel.
- [ ] Publicar uma demo estática com GitHub Pages.
- [ ] Criar validações mais completas para entradas inválidas.
- [ ] Tratar erros de APIs com mensagens visuais específicas.
- [ ] Criar testes unitários para as fórmulas de rentabilidade.

### Evolução do motor

- [ ] Histórico de cenários.
- [ ] Comparação lado a lado entre múltiplos contratos.
- [ ] Simulação de mudanças de dificuldade.
- [ ] Cenários otimista, base e pessimista.
- [ ] Curvas de sensibilidade para preço, dificuldade e custo.
- [ ] Persistência local opcional via `localStorage`/IndexedDB.
- [ ] Importação do JSON previamente exportado.
- [ ] Métricas de risco mais rigorosas no lugar da heurística simplificada.

### Engenharia e produto

- [ ] CI automatizada.
- [ ] Lint e formatação.
- [ ] Versionamento semântico.
- [ ] Changelog.
- [ ] Documentação técnica das fórmulas.
- [ ] Testes cross-browser.
- [ ] Melhorias de acessibilidade.
- [ ] Internacionalização.

---

## 🧠 O que este projeto demonstra no portfólio

O IdeaGold/Nimbus demonstra experiência prática com:

- modelagem de regras de negócio no front-end;
- transformação de fórmulas em indicadores compreensíveis;
- construção de dashboards sem frameworks;
- desenvolvimento responsivo;
- consumo de APIs públicas;
- tratamento de cenários de indisponibilidade de rede;
- geração de gráficos com Canvas API;
- exportação de dados no navegador;
- organização de UX para dados financeiros/técnicos;
- preocupação com segurança e limites de uma aplicação client-side;
- construção de heurísticas para apoio à decisão.

---

## 📂 Estrutura do repositório

```text
IdeaGold/
├── index.html
├── README.md
└── LICENSE
```

> A estrutura acima representa o estágio atual documentado do projeto e será expandida conforme o roadmap.

---

## 🤝 Contribuições

Este repositório é público para fins de demonstração e portfólio, mas **não é um projeto open source sob licença permissiva**.

Issues, sugestões e discussões podem ser bem-vindas, porém qualquer uso, cópia, redistribuição, modificação ou exploração do código depende de autorização expressa do titular dos direitos autorais, salvo quando permitido obrigatoriamente pela legislação aplicável.

---

## 👤 Autor

**Erick Israel**  
GitHub: [@eiisrael](https://github.com/eiisrael)

Projeto desenvolvido como estudo e protótipo de inteligência para análise de mineração SHA-256.

---

## © Direitos autorais

**Copyright © 2026 Erick Israel. Todos os direitos reservados.**

O código-fonte, interface, textos, regras específicas de implementação, identidade do projeto e demais materiais autorais deste repositório são protegidos pelas leis de direitos autorais aplicáveis.

A disponibilização pública do repositório no GitHub **não concede automaticamente licença de uso, cópia, modificação, distribuição, sublicenciamento ou exploração comercial**.

Consulte o arquivo [`LICENSE`](./LICENSE) para os termos aplicáveis a este repositório.

---

<div align="center">

### IdeaGold / Nimbus Hash Router

**Dados para entender o cenário. Heurísticas para comparar alternativas. Decisão final sempre humana.**

</div>
