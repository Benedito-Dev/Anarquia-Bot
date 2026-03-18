import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("divida")
  .setDescription("Controle de dividas com o caixa")
  .addSubcommand((sub) =>
    sub.setName("ver").setDescription("Ver quanto voce deve ao caixa"),
  )
  .addSubcommand((sub) =>
    sub.setName("listar").setDescription("Ver dividas de todos os membros (admin)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "ver") await ver(interaction);
  else if (sub === "listar") await listar(interaction);
}

async function ver(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const membro = db
    .prepare("SELECT nome, cargo FROM membros WHERE discord_id = ? AND ativo = 1")
    .get(discordId) as { nome: string; cargo: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: "Voce nao esta cadastrado na familia.", ephemeral: true });
    return;
  }

  const divida = db
    .prepare("SELECT valor_devido, atualizado_em FROM dividas WHERE membro_discord_id = ?")
    .get(discordId) as { valor_devido: number; atualizado_em: string } | undefined;

  const valorDevido = divida?.valor_devido ?? 0;

  const historico = db
    .prepare("SELECT tipo, valor, descricao, criado_em FROM dividas_log WHERE membro_discord_id = ? ORDER BY id DESC LIMIT 5")
    .all(discordId) as Array<{ tipo: string; valor: number; descricao: string | null; criado_em: string }>;

  let historicoTexto = "";
  for (const h of historico) {
    const emoji = h.tipo === "venda" ? "🛒" : "✅";
    const sinal = h.tipo === "venda" ? "+" : "-";
    historicoTexto += `${emoji} ${sinal}$${h.valor.toLocaleString()} — ${h.descricao ?? h.tipo} (${h.criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(valorDevido > 0 ? 0xe74c3c : 0x2ecc71)
    .setTitle(`💳 Divida com o Caixa — ${membro.nome}`)
    .addFields(
      { name: "Valor devido", value: `**$${valorDevido.toLocaleString()}**`, inline: true },
      { name: "Status", value: valorDevido > 0 ? "⚠️ Pendente" : "✅ Quite", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Ultimas movimentacoes", value: historicoTexto || "Nenhuma movimentacao." },
    )
    .setFooter({ text: "Use /caixa depositar para quitar sua divida" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function listar(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode ver as dividas de todos.", ephemeral: true });
    return;
  }

  const dividas = db
    .prepare(`
      SELECT m.nome, m.cargo, d.valor_devido, d.atualizado_em
      FROM dividas d
      JOIN membros m ON m.discord_id = d.membro_discord_id
      WHERE d.valor_devido > 0 AND m.ativo = 1
      ORDER BY d.valor_devido DESC
    `)
    .all() as Array<{ nome: string; cargo: string; valor_devido: number; atualizado_em: string }>;

  if (dividas.length === 0) {
    await interaction.reply({ content: "✅ Nenhum membro deve ao caixa no momento.", ephemeral: true });
    return;
  }

  const totalDevido = dividas.reduce((acc, d) => acc + d.valor_devido, 0);
  let texto = "";
  for (const d of dividas) {
    texto += `⚠️ **${d.nome}** (${d.cargo}) — $${d.valor_devido.toLocaleString()} (atualizado: ${d.atualizado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("💳 Dividas com o Caixa")
    .setDescription(texto)
    .addFields(
      { name: "Total em aberto", value: `**$${totalDevido.toLocaleString()}**`, inline: true },
      { name: "Membros devedores", value: `${dividas.length}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
