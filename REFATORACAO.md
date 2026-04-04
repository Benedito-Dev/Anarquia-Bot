# 💣 Plano de Refatoração Completa — Sistema Econômico ANARQUIA

## 📌 Contexto

Transição do sistema de farm de cobres/aluminios para produção e venda de munições.
Remoção completa do sistema de dinheiro sujo e lavagem.
Simplificação do sistema de ações.

---

## 🗄️ Banco de Dados

### Tabelas que SOMEM
- `dinheiro_entregas`
- `dinheiro_pagamentos`
- `dividas`
- `dividas_log`
- `acao_participantes` — substituída por `quantidade_membros` na tabela `acoes`

### Tabelas que MUDAM

| Tabela | O que muda |
|--------|-----------|
| `farm_entregas` | Troca `cobres/aluminios` por `polvora` e `capsula` (nova tabela via migration) |
| `estoque` | Zerar e trocar materiais para apenas `polvora` e `capsula` |
| `produtos` | Zerar e recriar com 5 tipos de munição (rifle/smg/pistola/doze/barret) |
| `produto_receita` | Recriar com custos de pólvora/cápsula por tipo |
| `vendas` | Adicionar coluna `tipo_municao`, remover colunas desnecessárias |
| `farmer_pagamentos` | Continua, pagamento sempre sai do caixa |
| `acoes` | Remover `porte`, adicionar `quantidade_membros`, nova divisão 70/30 |
| `parcerias` | Zerar dados, estrutura continua |
| `parceria_produtos` | Zerar dados, estrutura continua |

### Tabelas que FICAM IGUAIS
- `membros`
- `caixa`
- `caixa_log`
- `advertencias`
- `auditoria_log`
- `semanas_arquivadas`
- `bonus_log`

---

## 📁 Arquivos

### Somem completamente
- `src/commands/dinheiro.ts`
- `src/commands/divida.ts`
- `src/commands/grafico.ts`

### Mudam

| Arquivo | O que muda |
|---------|-----------|
| `db.ts` | Migrations para farm_entregas, estoque, produtos, vendas, acoes. Drop de tabelas removidas |
| `semana.ts` | Novas metas por cargo (pólvora/cápsula), remover getMetaDinheiroDiaria, novos tiers de bônus fim de semana |
| `farm.ts` | Troca cobres/aluminios por polvora/capsula, nova lógica de bônus fim de semana, pagamento sai do caixa |
| `venda.ts` | Nova divisão 40% vendedor / 60% fac, dívida só sobre os 40%, tipo de munição obrigatório |
| `estoque.ts` | Novos materiais (polvora/capsula) |
| `acao.ts` | Remove participantes individuais, adiciona quantidade_membros, nova divisão 70% caixa / 30% participantes |
| `relatorio.ts` | Remove seção dinheiro sujo, atualiza métricas de farm |
| `setup.ts` | Remove botão e handler de lavagem |
| `index.ts` | Remove handlers de lavagem, remove imports de dinheiro/divida/grafico |
| `parceria.ts` | Zerar dados via migration, sistema continua igual |

### Ficam iguais
- `advertencia.ts`
- `caixa.ts`
- `guia.ts`
- `membro.ts`

---

## 💰 Nova Economia

### Farm
- Materiais: pólvora e cápsula (registrados separadamente)
- Metas semanais por cargo:
  - Iniciante: 360 pólvora + 360 cápsula
  - Membro: 720 pólvora + 720 cápsula
  - Gerente+: sem meta
- Pagamento do farmer: **25% do valor de venda equivalente**, sai do caixa no momento da entrega
- Sábado: entrega obrigatória
- Domingo: opcional com bônus

### Bônus Fim de Semana (calculado por faixas de pólvora entregue)
- 80~170 pólvora → +15k
- 171~250 pólvora → +40k
- 251+ pólvora → +80k

> ⚠️ Valores de bônus ainda a serem ajustados

### Produção (custos por tipo)
| Tipo    | Pólvora | Cápsula | Rende   |
|---------|---------|---------|---------|
| Rifle   | 225     | 225     | 170 mun |
| SMG     | 175     | 175     | 170 mun |
| Pistola | 130     | 130     | 170 mun |
| Doze    | 180     | 180     | 170 mun |
| Barret  | 170     | 170     | 170 mun |

### Preços de Venda
| Tipo    | Com Parceria | Sem Parceria |
|---------|-------------|--------------|
| Rifle   | 910         | 1040         |
| SMG     | 650         | 799          |
| Pistola | 520         | 650          |
| Doze    | 1300        | 1430         |
| Barret  | 1500        | 1630         |

### Divisão de Vendas
- 40% → Vendedor (na hora)
- 60% → Caixa da organização
- Dívida do vendedor: 60% (valor que ele deve repassar à fac)

### Ações
- 70% → Caixa da organização (debitado automaticamente)
- 30% → Dividido igualmente entre os participantes (quantidade informada pelo gerente)
- Não existe mais registro individual de participantes

---

## ⚠️ Pontos Críticos no Banco

1. **`farm_entregas`** — SQLite não permite renomear colunas diretamente. Será necessário criar nova tabela, migrar dados e dropar a antiga
2. **`acao_participantes`** — tem foreign key, precisa ser dropada antes de alterar `acoes`
3. **`estoque`** — só zerar registros e inserir novos materiais, sem alterar estrutura
4. **`dinheiro_entregas/pagamentos`** — dropar apenas após garantir que nenhum comando as referencia
5. **Ordem das migrations** — respeitar dependências de foreign keys ao dropar tabelas

---

## 📋 Ordem de Execução Sugerida

1. Atualizar `semana.ts` (metas, constantes, tiers)
2. Atualizar `db.ts` (migrations e drops)
3. Remover `dinheiro.ts`, `divida.ts`, `grafico.ts`
4. Atualizar `index.ts` (remover imports e handlers)
5. Atualizar `farm.ts`
6. Atualizar `venda.ts`
7. Atualizar `estoque.ts`
8. Atualizar `acao.ts`
9. Atualizar `relatorio.ts`
10. Atualizar `setup.ts`
11. Testar localmente
12. Deploy na VPS
