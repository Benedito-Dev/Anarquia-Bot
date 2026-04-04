import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ACAO, PERCENT_CAIXA_ACAO, PERCENT_PARTICIPANTES_ACAO, getSemanaAtual } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("acao")
  .setDescription("Setor operacional — registrar acoes (gerente de acao+)")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar acao com dinheiro (70% caixa / 30% participantes)")
      .addIntegerOption((opt) =>
        opt.setName("valor_total").setDescription("Valor total gerado na acao").setRequired(true).setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt.setName("membros").setDescription("Quantidade de membros participantes").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("historico").setDescription("Historico de acoes da semana"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ACAO.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente de Acao ou superior** pode registrar acoes.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "registrar") await registrar(interaction, admin.nome);
  else if (sub === "historico") await historico(interaction);
}

async function registrar(interaction: ChatInputCommandInteraction, adminNome: string) {
  const valorTotal = interaction.options.getInteger("valor_total", true);
  const quantidadeMembros = interaction.options.getInteger("membros", true);
  const semana = getSemanaAtual();

  const valorCaixa = Math.round(valorTotal * PERCENT_CAIXA_ACAO);
  const valorParticipantes = Math.round(valorTotal * PERCENT_PARTICIPANTES_ACAO);
  const valorPorMembro = Math.round(valorParticipantes / quantidadeMembros);

  db.transaction(() => {
    db.prepare(
      "INSERT INTO acoes (valor_total, valor_caixa, valor_por_membro, quantidade_membros, registrado_por, semana) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(valorTotal, valorCaixa, valorPorMembro, quantidadeMembros, interaction.user.id, semana);

    db.prepare("UPDATE caixa SET saldo = saldo + ?").run(valorCaixa);
    db.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run(
      "acao", valorCaixa, `Acao — ${quantidadeMembros} participantes`, interaction.user.id,
    );
  })();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Acao Registrada!")
        .addFields(
          { name: "Valor total", value: `$${valorTotal.toLocaleString()}`, inline: true },
          { name: "Participantes", value: `${quantidadeMembros}`, inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "Caixa (70%)", value: `$${valorCaixa.toLocaleString()}`, inline: true },
          { name: "Participantes (30%)", value: `$${valorParticipantes.toLocaleString()}`, inline: true },
          { name: "Por membro", value: `$${valorPorMembro.toLocaleString()}`, inline: true },
        )
        .setFooter({ text: `Registrado por ${adminNome}` })
        .setTimestamp(),
    ],
  });
}

async function historico(interaction: ChatInputCommandInteraction) {
  const semana = getSemanaAtual();

  const acoes = db
    .prepare("SELECT * FROM acoes WHERE semana = ? ORDER BY id DESC")
    .all(semana) as Array<{
      id: number; valor_total: number; valor_caixa: number;
      valor_por_membro: number; quantidade_membros: number;
      registrado_por: string; criado_em: string;
    }>;

  if (acoes.length === 0) {
    await interaction.reply({ content: "Nenhuma acao registrada essa semana.", ephemeral: true });
    return;
  }

  const totalGerado = acoes.reduce((acc, a) => acc + a.valor_total, 0);
  const totalCaixa = acoes.reduce((acc, a) => acc + a.valor_caixa, 0);

  let texto = "";
  for (const a of acoes) {
    texto += `\`#${a.id}\` $${a.valor_total.toLocaleString()} — ${a.quantidade_membros} membros | $${a.valor_por_membro.toLocaleString()}/pessoa (${a.criado_em})\n`;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`Acoes da Semana — ${semana}`)
        .setDescription(texto)
        .addFields(
          { name: "Total gerado", value: `$${totalGerado.toLocaleString()}`, inline: true },
          { name: "Total pro caixa", value: `$${totalCaixa.toLocaleString()}`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}
