"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.initDatabaseV2 = initDatabaseV2;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const dbPath = path_1.default.join(__dirname, "..", "..", "farm-bot.db");
const db = new better_sqlite3_1.default(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function initDatabase() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS membros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
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
      quantidade_produtos INTEGER NOT NULL,
      cobres_usados INTEGER NOT NULL,
      aluminios_usados INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
    // Inicializar tabelas v2 (vendas, caixa, bonus)
    initDatabaseV2();
    // Inicializar estoque se vazio
    const count = db.prepare("SELECT COUNT(*) as total FROM estoque").get();
    if (count.total === 0) {
        const insert = db.prepare("INSERT INTO estoque (material, quantidade) VALUES (?, ?)");
        insert.run("cobres", 0);
        insert.run("aluminios", 0);
        insert.run("produtos", 0);
    }
}
exports.default = db;
function initDatabaseV2() {
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
  `);
    // Inicializar caixa se vazio
    const caixaCount = db.prepare("SELECT COUNT(*) as total FROM caixa").get();
    if (caixaCount.total === 0) {
        db.prepare("INSERT INTO caixa (saldo) VALUES (0)").run();
    }
}
