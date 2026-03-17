"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const db_1 = __importDefault(require("../database/db"));
const semana_1 = require("../utils/semana");
const PRECO_SEM_PARCERIA = 8300;
const PRECO_COM_PARCERIA = 6500;
const PERCENT_VENDEDOR = 0.45;
const PERCENT_FAMILIA = 0.55; // 30% caixa + 25% que ja foi pago ao farmer na entrega
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("venda")
    .setDescription("Comandos de venda (gerente+)")
    .addSubcommand((sub) => sub
    .setName("registrar")
    .setDescription("Registrar venda de produtos")
    .addIntegerOption((opt) => opt
    .setName("quantidade")
    .setDescription("Quantidade de produtos vendidos")
    .setRequired(true)
    .setMinValue(1))
    .addBooleanOption((opt) => opt
    .setName("parceria")
    .setDescription("Venda com parceria? (preco menor)")
    .setRequired(true)))
    .addSubcommand((sub) => sub.setName("historico").setDescription("Ultimas vendas"));
async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "registrar") {
        await registrar(interaction);
    }
    else if (subcommand === "historico") {
        await historico(interaction);
    }
}
async function registrar(interaction) {
    const discordId = interaction.user.id;
    const membro = db_1.default
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(discordId);
    if (!membro || !semana_1.CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
        await interaction.reply({
            content: "Apenas **Gerente ou superior** pode registrar vendas.",
            ephemeral: true,
        });
        return;
    }
    const quantidade = interaction.options.getInteger("quantidade", true);
    const comParceria = interaction.options.getBoolean("parceria", true);
    // Verificar estoque de produtos prontos
    const estoqueProdutos = db_1.default
        .prepare("SELECT quantidade FROM estoque WHERE material = 'produtos'")
        .get();
    if (estoqueProdutos.quantidade < quantidade) {
        await interaction.reply({
            content: `Estoque insuficiente. Tem ${estoqueProdutos.quantidade} produtos prontos, precisa de ${quantidade}.\nUse \`/estoque produzir\` primeiro.`,
            ephemeral: true,
        });
        return;
    }
    const precoUnitario = comParceria ? PRECO_COM_PARCERIA : PRECO_SEM_PARCERIA;
    const receitaTotal = quantidade * precoUnitario;
    const valorVendedor = Math.round(receitaTotal * PERCENT_VENDEDOR);
    const valorFamilia = receitaTotal - valorVendedor; // Tudo que sobra (inclui 25% farmer ja pago + 30% caixa)
    const vendaTransaction = db_1.default.transaction(() => {
        // Descontar do estoque
        db_1.default.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = 'produtos'").run(quantidade);
        // Registrar venda
        db_1.default.prepare("INSERT INTO vendas (vendedor_discord_id, quantidade_produtos, preco_unitario, com_parceria, receita_total, valor_vendedor, valor_familia) VALUES (?, ?, ?, ?, ?, ?, ?)").run(discordId, quantidade, precoUnitario, comParceria ? 1 : 0, receitaTotal, valorVendedor, valorFamilia);
        // Adicionar ao caixa da familia
        db_1.default.prepare("UPDATE caixa SET saldo = saldo + ?").run(valorFamilia);
        // Log do caixa
        db_1.default.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run("venda", valorFamilia, `Venda de ${quantidade} produtos (${comParceria ? "com" : "sem"} parceria) por ${membro.nome}`, discordId);
        // Log do estoque
        db_1.default.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run("produtos", -quantidade, "venda", `Venda por ${membro.nome}`, discordId);
    });
    vendaTransaction();
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle("Venda Registrada!")
        .addFields({ name: "Produtos vendidos", value: `${quantidade}`, inline: true }, { name: "Tipo", value: comParceria ? "Com parceria" : "Sem parceria", inline: true }, { name: "Preco unitario", value: `$${precoUnitario.toLocaleString()}`, inline: true }, { name: "═══ Distribuicao ═══", value: "\u200b" }, { name: "Receita total", value: `$${receitaTotal.toLocaleString()}`, inline: true }, { name: `Vendedor (45%)`, value: `$${valorVendedor.toLocaleString()}`, inline: true }, { name: `Caixa familia`, value: `$${valorFamilia.toLocaleString()}`, inline: true })
        .setFooter({ text: `Vendido por ${membro.nome} | Farmer ja foi pago na entrega do material` })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function historico(interaction) {
    const vendas = db_1.default
        .prepare(`SELECT v.*, m.nome as vendedor_nome
      FROM vendas v
      LEFT JOIN membros m ON m.discord_id = v.vendedor_discord_id
      ORDER BY v.id DESC LIMIT 10`)
        .all();
    if (vendas.length === 0) {
        await interaction.reply({ content: "Nenhuma venda registrada ainda.", ephemeral: true });
        return;
    }
    let texto = "";
    for (const v of vendas) {
        const tipo = v.com_parceria ? "parceria" : "sem parceria";
        texto += `🛒 **${v.quantidade_produtos} produtos** (${tipo}) — $${v.receita_total.toLocaleString()} | Vendedor: ${v.vendedor_nome ?? "?"} (${v.criado_em})\n`;
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle("Historico de Vendas (ultimas 10)")
        .setDescription(texto)
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
