import Database, { Database as DatabaseType } from "better-sqlite3";
import path from "path";

const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "..", "..", "farm-bot.db");
const db: DatabaseType = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS membros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      passaporte INTEGER UNIQUE NOT NULL DEFAULT 0,
      cargo TEXT NOT NULL DEFAULT 'iniciante',
      setor TEXT NOT NULL DEFAULT 'producao',
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS farm_entregas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      cobres INTEGER NOT NULL DEFAULT 0,
      aluminios INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      semana TEXT NOT NULL,
      FOREIGN KEY (membro_id) REFERENCES membros(id)
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

    CREATE TABLE IF NOT EXISTS producao_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_discord_id TEXT NOT NULL,
      produto TEXT NOT NULL DEFAULT 'c4',
      quantidade_produtos INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      preco_sem_parceria INTEGER NOT NULL,
      preco_com_parceria INTEGER NOT NULL,
      fabricavel INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS produto_receita (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      material TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    );
  `);

  // Inicializar tabelas v2 (vendas, caixa, bonus)
  initDatabaseV2();

  // Migration: adicionar coluna passaporte se nao existir
  const colunas = db.prepare("PRAGMA table_info(membros)").all() as Array<{ name: string }>;
  if (!colunas.some((c) => c.name === "passaporte")) {
    db.exec("ALTER TABLE membros ADD COLUMN passaporte INTEGER");
  }

  // Migration: adicionar coluna produto em vendas se nao existir
  const colunasVendas = db.prepare("PRAGMA table_info(vendas)").all() as Array<{ name: string }>;
  if (!colunasVendas.some((c) => c.name === "produto")) {
    db.exec("ALTER TABLE vendas ADD COLUMN produto TEXT NOT NULL DEFAULT 'c4'");
  }

  // Inicializar materiais no estoque se nao existirem
  const materiais = ["cobres", "aluminios", "lona", "plastico", "algodao", "couro", "chapa de metal", "lixo eletronico"];
  for (const mat of materiais) {
    const existe = db.prepare("SELECT id FROM estoque WHERE material = ?").get(mat);
    if (!existe) db.prepare("INSERT INTO estoque (material, quantidade) VALUES (?, 0)").run(mat);
  }

  // Inicializar catalogo de produtos
  initProdutos();
}

function initProdutos(): void {
  const produtos: Array<{ nome: string; sem: number; com: number; fabricavel: number; receita: Array<[string, number]> }> = [
    { nome: "c4",                  sem: 8300,  com: 6500,  fabricavel: 1, receita: [["aluminios", 6], ["cobres", 6]] },
    { nome: "pager",               sem: 8300,  com: 6500,  fabricavel: 1, receita: [["aluminios", 12], ["chapa de metal", 8], ["plastico", 5]] },
    { nome: "colete",              sem: 1200,  com: 910,   fabricavel: 1, receita: [["algodao", 6], ["plastico", 6]] },
    { nome: "ticket de corrida",   sem: 4000,  com: 1300,  fabricavel: 0, receita: [] },
    { nome: "cartao comum",        sem: 8300,  com: 6500,  fabricavel: 1, receita: [["cobres", 4], ["plastico", 4]] },
    { nome: "cartao incomum",      sem: 15000, com: 13000, fabricavel: 1, receita: [["cobres", 6], ["plastico", 6]] },
    { nome: "cartao raro",         sem: 21300, com: 19500, fabricavel: 1, receita: [["cobres", 5], ["plastico", 5]] },
    { nome: "cartao epico",        sem: 44150, com: 42250, fabricavel: 1, receita: [["cobres", 5], ["plastico", 5]] },
    { nome: "cartao lendario",     sem: 67000, com: 65000, fabricavel: 1, receita: [["cobres", 6], ["plastico", 6]] },
    { nome: "mochila",             sem: 12300, com: 10000, fabricavel: 1, receita: [["algodao", 4], ["couro", 7], ["plastico", 2]] },
    { nome: "algemas",             sem: 10500, com: 9000,  fabricavel: 0, receita: [] },
    { nome: "bloqueador de sinal", sem: 650,   com: 390,   fabricavel: 1, receita: [["aluminios", 2], ["lona", 1], ["plastico", 5]] },
    { nome: "attach unidade",      sem: 5200,  com: 4550,  fabricavel: 1, receita: [["aluminios", 4], ["lixo eletronico", 4]] },
    { nome: "attach kit",          sem: 26000, com: 26000, fabricavel: 1, receita: [["aluminios", 20], ["lixo eletronico", 20]] },
  ];

  for (const p of produtos) {
    const existe = db.prepare("SELECT id FROM produtos WHERE nome = ?").get(p.nome) as { id: number } | undefined;
    if (!existe) {
      const res = db.prepare("INSERT INTO produtos (nome, preco_sem_parceria, preco_com_parceria, fabricavel) VALUES (?, ?, ?, ?)").run(p.nome, p.sem, p.com, p.fabricavel);
      for (const [mat, qtd] of p.receita) {
        db.prepare("INSERT INTO produto_receita (produto_id, material, quantidade) VALUES (?, ?, ?)").run(res.lastInsertRowid, mat, qtd);
      }
    }
  }
}

export default db;

export function initDatabaseV2(): void {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS farmer_pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      farm_entrega_id INTEGER NOT NULL,
      produtos_equivalentes INTEGER NOT NULL,
      valor_pago INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id)
    );

    CREATE TABLE IF NOT EXISTS vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendedor_discord_id TEXT NOT NULL,
      produto TEXT NOT NULL DEFAULT 'c4',
      quantidade_produtos INTEGER NOT NULL,
      preco_unitario INTEGER NOT NULL,
      com_parceria INTEGER NOT NULL DEFAULT 0,
      receita_total INTEGER NOT NULL,
      valor_vendedor INTEGER NOT NULL,
      valor_familia INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS advertencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membro_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      dado_por TEXT NOT NULL,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (membro_id) REFERENCES membros(id)
    );

    CREATE TABLE IF NOT EXISTS acao_participantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acao_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      valor_recebido INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS acoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      porte TEXT,
      valor_total INTEGER NOT NULL,
      valor_caixa INTEGER NOT NULL,
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
