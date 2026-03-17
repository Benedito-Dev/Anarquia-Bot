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
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("membro")
    .setDescription("Comandos de membros (admin)")
    .addSubcommand((sub) => sub
    .setName("cadastrar")
    .setDescription("Cadastrar membro na familia (admin)")
    .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true))
    .addStringOption((opt) => opt
    .setName("cargo")
    .setDescription("Cargo do membro")
    .setRequired(true)
    .addChoices({ name: "Iniciante", value: "iniciante" }, { name: "Membro", value: "membro" }, { name: "Farmer Veterano", value: "farmer veterano" }, { name: "Gerente", value: "gerente" }, { name: "Sublider", value: "sublider" }, { name: "Lider", value: "lider" })))
    .addSubcommand((sub) => sub
    .setName("promover")
    .setDescription("Promover membro (admin)")
    .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true))
    .addStringOption((opt) => opt
    .setName("cargo")
    .setDescription("Novo cargo")
    .setRequired(true)
    .addChoices({ name: "Iniciante", value: "iniciante" }, { name: "Membro", value: "membro" }, { name: "Farmer Veterano", value: "farmer veterano" }, { name: "Gerente", value: "gerente" }, { name: "Sublider", value: "sublider" }, { name: "Lider", value: "lider" })))
    .addSubcommand((sub) => sub.setName("listar").setDescription("Listar todos os membros"))
    .addSubcommand((sub) => sub
    .setName("remover")
    .setDescription("Remover membro da familia (admin)")
    .addUserOption((opt) => opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true)));
async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    // Verificar se e admin (exceto listar)
    // Se nao existe nenhum membro, permite o primeiro cadastro (setup inicial)
    if (subcommand !== "listar") {
        const totalMembros = db_1.default.prepare("SELECT COUNT(*) as total FROM membros WHERE ativo = 1").get();
        const isFirstSetup = totalMembros.total === 0 && subcommand === "cadastrar";
        if (!isFirstSetup) {
            const admin = db_1.default
                .prepare("SELECT * FROM membros WHERE discord_id = ?")
                .get(interaction.user.id);
            if (!admin || !semana_1.CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
                await interaction.reply({
                    content: "Apenas **Sublider ou Lider** pode gerenciar membros.",
                    ephemeral: true,
                });
                return;
            }
        }
    }
    if (subcommand === "cadastrar") {
        await cadastrar(interaction);
    }
    else if (subcommand === "promover") {
        await promover(interaction);
    }
    else if (subcommand === "listar") {
        await listar(interaction);
    }
    else if (subcommand === "remover") {
        await remover(interaction);
    }
}
async function cadastrar(interaction) {
    const usuario = interaction.options.getUser("usuario", true);
    const cargo = interaction.options.getString("cargo", true);
    if (!semana_1.CARGOS_VALIDOS.includes(cargo)) {
        await interaction.reply({ content: `Cargo invalido. Validos: ${semana_1.CARGOS_VALIDOS.join(", ")}`, ephemeral: true });
        return;
    }
    // Verificar se ja existe
    const existente = db_1.default.prepare("SELECT * FROM membros WHERE discord_id = ?").get(usuario.id);
    if (existente) {
        await interaction.reply({ content: `**${usuario.displayName}** ja esta cadastrado.`, ephemeral: true });
        return;
    }
    db_1.default.prepare("INSERT INTO membros (discord_id, nome, cargo) VALUES (?, ?, ?)").run(usuario.id, usuario.displayName, cargo);
    const meta = (0, semana_1.getMetaSemanal)(cargo);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Membro Cadastrado!")
        .addFields({ name: "Nome", value: usuario.displayName, inline: true }, { name: "Cargo", value: (0, semana_1.getCargoLabel)(cargo), inline: true }, { name: "Meta semanal", value: meta > 0 ? `${meta} cobres` : "Sem meta", inline: true })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function promover(interaction) {
    const usuario = interaction.options.getUser("usuario", true);
    const novoCargo = interaction.options.getString("cargo", true);
    const membro = db_1.default
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(usuario.id);
    if (!membro) {
        await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
        return;
    }
    const cargoAnterior = membro.cargo;
    db_1.default.prepare("UPDATE membros SET cargo = ?, nome = ? WHERE discord_id = ?").run(novoCargo, usuario.displayName, usuario.id);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("Membro Promovido!")
        .addFields({ name: "Nome", value: usuario.displayName, inline: true }, { name: "Cargo anterior", value: (0, semana_1.getCargoLabel)(cargoAnterior), inline: true }, { name: "Novo cargo", value: (0, semana_1.getCargoLabel)(novoCargo), inline: true }, { name: "Nova meta", value: (0, semana_1.getMetaSemanal)(novoCargo) > 0 ? `${(0, semana_1.getMetaSemanal)(novoCargo)} cobres/semana` : "Sem meta", inline: true })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function listar(interaction) {
    const membros = db_1.default
        .prepare("SELECT discord_id, nome, cargo FROM membros WHERE ativo = 1 ORDER BY CASE cargo WHEN 'lider' THEN 1 WHEN 'sublider' THEN 2 WHEN 'gerente' THEN 3 WHEN 'farmer veterano' THEN 4 WHEN 'membro' THEN 5 WHEN 'iniciante' THEN 6 END")
        .all();
    if (membros.length === 0) {
        await interaction.reply({ content: "Nenhum membro cadastrado.", ephemeral: true });
        return;
    }
    let texto = "";
    let cargoAtual = "";
    for (const m of membros) {
        if (m.cargo !== cargoAtual) {
            cargoAtual = m.cargo;
            texto += `\n**— ${(0, semana_1.getCargoLabel)(m.cargo)} —**\n`;
        }
        const meta = (0, semana_1.getMetaSemanal)(m.cargo);
        texto += `<@${m.discord_id}> — Meta: ${meta > 0 ? `${meta} cobres` : "Sem meta"}\n`;
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`Membros da Familia (${membros.length})`)
        .setDescription(texto)
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function remover(interaction) {
    const usuario = interaction.options.getUser("usuario", true);
    const membro = db_1.default
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(usuario.id);
    if (!membro) {
        await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
        return;
    }
    db_1.default.prepare("UPDATE membros SET ativo = 0 WHERE discord_id = ?").run(usuario.id);
    await interaction.reply({
        embeds: [
            new discord_js_1.EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("Membro Removido")
                .setDescription(`**${membro.nome}** foi removido da familia.`)
                .setTimestamp(),
        ],
    });
}
