import Database, { Database as DatabaseType } from "better-sqlite3";
import path from "path";

const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "..", "..", "farm-bot.db");
const db: DatabaseType = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDatabase(): void {
  // Tabelas que nunca mudam
  db.exec(`
    CREATE TABLE IF NOT EXISTS membros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      passaporte INTEGER UNIQUE NOT NULL DEFAULT 0,
      cargo TEXT NOT NULL DEFAULT 'iniciante',
      setor TEXT NOT NULL DEFAULT 'producao',
      ativo INTEGER NOT NULL DEFAULT 1,
      folga_dia TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saldo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS caixa_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      valor INTEGER NOT NULL,
      descricao TEXT,
      membro_discord_id TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auditoria_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acao TEXT NOT NULL,
      executado_por TEXT NOT NULL,
      alvo TEXT,
      detalhes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS advertencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      dado_por TEXT NOT NULL,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id)
    );

    CREATE TABLE IF NOT EXISTS semanas_arquivadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semana TEXT NOT NULL,
      dados_json TEXT NOT NULL,
      arquivado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bonus_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      valor INTEGER NOT NULL,
      descricao TEXT,
      semana TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id)
    );

    CREATE TABLE IF NOT EXISTS parcerias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'mutuo',
      desconto_percent INTEGER NOT NULL DEFAULT 0,
      contato_discord_id TEXT,
      observacoes TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS parceria_produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parceria_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'outro',
      preco INTEGER,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parceria_id) REFERENCES parcerias(id)
    );

    CREATE TABLE IF NOT EXISTS vendas_canceladas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      cancelado_por TEXT NOT NULL,
      motivo TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);

  initDatabaseV2();
  runMigrations();
}

function initDatabaseV2(): void {
  // Nova tabela farm_entregas com polvora/capsula
  db.exec(`
    CREATE TABLE IF NOT EXISTS farm_entregas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      polvora INTEGER NOT NULL DEFAULT 0,
      capsula INTEGER NOT NULL DEFAULT 0,
      semana TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id)
    );

    CREATE TABLE IF NOT EXISTS farmer_pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      farm_entrega_id INTEGER NOT NULL,
      valor_pago INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id),
      FOREIGN KEY (farm_entrega_id) REFERENCES farm_entregas(id)
    );

    CREATE TABLE IF NOT EXISTS estoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material TEXT UNIQUE NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS estoque_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT,
      membro_discord_id TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      preco_sem_parceria INTEGER NOT NULL,
      preco_com_parceria INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS produto_receita (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      material TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    );

    CREATE TABLE IF NOT EXISTS producao_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_discord_id TEXT NOT NULL,
      produto TEXT NOT NULL,
      quantidade_producoes INTEGER NOT NULL,
      municoes_geradas INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendedor_discord_id TEXT NOT NULL,
      tipo_municao TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      preco_unitario INTEGER NOT NULL,
      com_parceria INTEGER NOT NULL DEFAULT 0,
      receita_total INTEGER NOT NULL,
      valor_vendedor INTEGER NOT NULL,
      valor_familia INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dividas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_discord_id TEXT NOT NULL,
      valor_devido INTEGER NOT NULL DEFAULT 0,
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dividas_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_discord_id TEXT NOT NULL,
      tipo TEXT NOT NULL,
      valor INTEGER NOT NULL,
      descricao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS acoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      valor_total INTEGER NOT NULL,
      valor_caixa INTEGER NOT NULL,
      valor_por_membro INTEGER NOT NULL,
      quantidade_membros INTEGER NOT NULL,
      registrado_por TEXT NOT NULL,
      semana TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Inicializar caixa se vazio
  const caixaCount = db.prepare("SELECT COUNT(*) as total FROM caixa").get() as { total: number };
  if (caixaCount.total === 0) {
    db.prepare("INSERT INTO caixa (saldo) VALUES (0)").run();
  }
}

function runMigrations(): void {
  // Migration: membros — garantir colunas novas
  const colunasMembros = db.prepare("PRAGMA table_info(membros)").all() as Array<{ name: string }>;
  if (!colunasMembros.some((c) => c.name === "folga_dia")) {
    db.exec("ALTER TABLE membros ADD COLUMN folga_dia TEXT");
  }
  if (!colunasMembros.some((c) => c.name === "vip")) {
    db.exec("ALTER TABLE membros ADD COLUMN vip INTEGER NOT NULL DEFAULT 0");
  }

  // Migration: criar tabela dominas_log se não existir
  db.exec(`
    CREATE TABLE IF NOT EXISTS dominas_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dia TEXT NOT NULL UNIQUE,
      registrado_por TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: farm_entregas — se ainda tiver colunas antigas (cobres/aluminios), recriar
  const colunasFarm = db.prepare("PRAGMA table_info(farm_entregas)").all() as Array<{ name: string }>;
  const temCobres = colunasFarm.some((c) => c.name === "cobres");
  if (temCobres) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE farm_entregas_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          membro_id INTEGER NOT NULL,
          polvora INTEGER NOT NULL DEFAULT 0,
          capsula INTEGER NOT NULL DEFAULT 0,
          semana TEXT NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (membro_id) REFERENCES membros(id)
        );
      `);
      // Dados antigos não são migrados pois cobres != polvora
      db.exec("DROP TABLE farm_entregas");
      db.exec("ALTER TABLE farm_entregas_nova RENAME TO farm_entregas");

      // farmer_pagamentos pode ter FK para farm_entregas antiga, recriar também
      db.exec("DROP TABLE IF EXISTS farmer_pagamentos");
      db.exec(`
        CREATE TABLE farmer_pagamentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          membro_id INTEGER NOT NULL,
          farm_entrega_id INTEGER NOT NULL,
          valor_pago INTEGER NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (membro_id) REFERENCES membros(id),
          FOREIGN KEY (farm_entrega_id) REFERENCES farm_entregas(id)
        );
      `);
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: farmer_pagamentos — remover coluna produtos_equivalentes se existir
  const colunasFarmerPag = db.prepare("PRAGMA table_info(farmer_pagamentos)").all() as Array<{ name: string }>;
  if (colunasFarmerPag.some((c) => c.name === "produtos_equivalentes")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE farmer_pagamentos_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          membro_id INTEGER NOT NULL,
          farm_entrega_id INTEGER NOT NULL,
          valor_pago INTEGER NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (membro_id) REFERENCES membros(id),
          FOREIGN KEY (farm_entrega_id) REFERENCES farm_entregas(id)
        );
      `);
      db.exec("INSERT INTO farmer_pagamentos_nova (id, membro_id, farm_entrega_id, valor_pago, criado_em) SELECT id, membro_id, farm_entrega_id, valor_pago, criado_em FROM farmer_pagamentos");
      db.exec("DROP TABLE farmer_pagamentos");
      db.exec("ALTER TABLE farmer_pagamentos_nova RENAME TO farmer_pagamentos");
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: vendas — recriar se ainda tiver estrutura antiga (coluna 'produto' no lugar de 'tipo_municao')
  const colunasVendas = db.prepare("PRAGMA table_info(vendas)").all() as Array<{ name: string }>;
  if (colunasVendas.some((c) => c.name === "produto") && !colunasVendas.some((c) => c.name === "tipo_municao")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE vendas_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendedor_discord_id TEXT NOT NULL,
          tipo_municao TEXT NOT NULL,
          quantidade INTEGER NOT NULL,
          preco_unitario INTEGER NOT NULL,
          com_parceria INTEGER NOT NULL DEFAULT 0,
          receita_total INTEGER NOT NULL,
          valor_vendedor INTEGER NOT NULL,
          valor_familia INTEGER NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Dados antigos não migrados — estrutura incompatível
      db.exec("DROP TABLE vendas");
      db.exec("ALTER TABLE vendas_nova RENAME TO vendas");
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: acoes — recriar se tiver estrutura antiga (coluna 'porte')
  const colunasAcoes = db.prepare("PRAGMA table_info(acoes)").all() as Array<{ name: string }>;
  if (colunasAcoes.some((c) => c.name === "porte")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      // Dropar acao_participantes primeiro (dependia de acoes)
      db.exec("DROP TABLE IF EXISTS acao_participantes");
      db.exec(`
        CREATE TABLE acoes_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          valor_total INTEGER NOT NULL,
          valor_caixa INTEGER NOT NULL,
          valor_por_membro INTEGER NOT NULL,
          quantidade_membros INTEGER NOT NULL,
          registrado_por TEXT NOT NULL,
          semana TEXT NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec("DROP TABLE acoes");
      db.exec("ALTER TABLE acoes_nova RENAME TO acoes");
    })();
    db.pragma("foreign_keys = ON");
  }

  // Migration: produtos — recriar com munições se ainda tiver produtos antigos (c4, pager, etc)
  const produtoAntigo = db.prepare("SELECT id FROM produtos WHERE nome = 'c4'").get();
  if (produtoAntigo) {
    db.transaction(() => {
      db.exec("DELETE FROM produto_receita");
      db.exec("DELETE FROM produtos");
    })();
  }

  // Migration: estoque — remover materiais antigos e inserir polvora/capsula
  const estoqueAntigo = db.prepare("SELECT id FROM estoque WHERE material = 'cobres'").get();
  if (estoqueAntigo) {
    db.transaction(() => {
      db.exec("DELETE FROM estoque");
      db.exec("DELETE FROM estoque_log");
    })();
  }

  // Migration: remover tabelas de dinheiro sujo se existirem
  db.pragma("foreign_keys = OFF");
  db.exec("DROP TABLE IF EXISTS dinheiro_pagamentos");
  db.exec("DROP TABLE IF EXISTS dinheiro_entregas");
  db.pragma("foreign_keys = ON");

  // Inicializar estoque com novos materiais
  const materiais = ["polvora", "capsula"];
  for (const mat of materiais) {
    const existe = db.prepare("SELECT id FROM estoque WHERE material = ?").get(mat);
    if (!existe) db.prepare("INSERT INTO estoque (material, quantidade) VALUES (?, 0)").run(mat);
  }

  // Inicializar catálogo de munições
  initMunicoes();
}

function initMunicoes(): void {
  const municoes: Array<{ nome: string; sem: number; com: number; polvora: number; capsula: number }> = [
    { nome: "rifle",   sem: 1040, com: 910,  polvora: 225, capsula: 225 },
    { nome: "smg",     sem: 799,  com: 650,  polvora: 175, capsula: 175 },
    { nome: "pistola", sem: 650,  com: 520,  polvora: 130, capsula: 130 },
    { nome: "doze",    sem: 1430, com: 1300, polvora: 180, capsula: 180 },
    { nome: "barret",  sem: 1630, com: 1500, polvora: 170, capsula: 170 },
  ];

  for (const m of municoes) {
    const existe = db.prepare("SELECT id FROM produtos WHERE nome = ?").get(m.nome) as { id: number } | undefined;
    if (!existe) {
      const res = db.prepare("INSERT INTO produtos (nome, preco_sem_parceria, preco_com_parceria) VALUES (?, ?, ?)").run(m.nome, m.sem, m.com);
      db.prepare("INSERT INTO produto_receita (produto_id, material, quantidade) VALUES (?, ?, ?)").run(res.lastInsertRowid, "polvora", m.polvora);
      db.prepare("INSERT INTO produto_receita (produto_id, material, quantidade) VALUES (?, ?, ?)").run(res.lastInsertRowid, "capsula", m.capsula);
    }
  }
}

export default db;
