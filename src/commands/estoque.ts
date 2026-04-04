import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, CARGOS_GERENCIA, registrarAuditoria } from "../utils/semana";

const CHOICES_MUNICOES = [
  { name: "Rifle", value: "rifle" },
  { name: "SMG", value: "smg" },
  { name: "Pistola", value: "pistola" },
  { name: "Doze", value: "doze" },
  { name: "Barret", value: "barret" },
];

export const data = new SlashCommandBuilder()
  .setName("estoque")
  .setDescription("Comandos de estoque")
  .addSubcommand((sub) => sub.setName("ver").setDescription("Ver estoque atual"))
  .addSubcommand((sub) =>
    sub
      .setName("produzir")
      .setDescription("Fabricar municoes (gerente+)")
      .addStringOption((opt) =>
        opt.setName("tipo").setDescription("Tipo de municao").setRequired(true).addChoices(...CHOICES_MUNICOES),
      )
      .addIntegerOption((opt) =>
        opt.setName("quantidade").setDescription("Quantidade de producoes").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) => sub.setName("historico").setDescription("Ultimas movimentacoes do estoque"))
  .addSubcommand((sub) =>
    sub
      .setName("ajuste")
      .setDescription("Ajuste manual do estoque (admin)")
      .addStringOption((opt) =>
        opt.setName("material").setDescription("Material ou municao").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("quantidade").setDescription("Quantidade (negativo para remover)").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo do ajuste").setRequired(true),
      ),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const itens = db.prepare("SELECT material FROM estoque ORDER BY material").all() as Array<{ material: string }>;
  const filtered = itens
    .filter((i) => i.material.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((i) => ({ name: i.material, value: i.material }));
  await interaction.respond(filtered);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "ver") await ver(interaction);
  else if (sub === "produzir") await produzir(interaction);
  else if (sub === "historico") await historico(interaction);
  else if (sub === "ajuste") await ajuste(interaction);
}

async function ver(interaction: ChatInputCommandInteraction) {
  const materiais = db
    .prepare("SELECT material, quantidade FROM estoque WHERE material IN ('polvora', 'capsula') ORDER BY material")
    .all() as Array<{ material: string; quantidade: number }>;

  const municoes = db
    .prepare("SELECT e.material, e.quantidade FROM estoque e JOIN produtos p ON p.nome = e.material ORDER BY e.material")
    .all() as Array<{ material: string; quantidade: number }>;

  const textoMateriais = materiais.map((e) => `**${e.material}:** ${e.quantidade}`).join("\n") || "Vazio";
  const textoMunicoes = municoes.map((e) => `**${e.material.toUpperCase()}:** ${e.quantidade}`).join("\n") || "Vazio";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("Estoque da Familia")
        .addFields(
          { name: "🧪 Materiais", value: textoMateriais, inline: true },
          { name: "💣 Municoes", value: textoMunicoes, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function produzir(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro || !CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode fabricar municoes.", ephemeral: true });
    return;
  }

  const tipoMunicao = interaction.options.getString("tipo", true);
  const quantidadeProducoes = interaction.options.getInteger("quantidade", true);
  const MUNICOES_POR_PRODUCAO = 170;

  const produto = db
    .prepare("SELECT * FROM produtos WHERE nome = ?")
    .get(tipoMunicao) as { id: number; nome: string } | undefined;

  if (!produto) {
    await interaction.reply({ content: `Municao **${tipoMunicao}** nao encontrada.`, ephemeral: true });
    return;
  }

  const receita = db
    .prepare("SELECT material, quantidade FROM produto_receita WHERE produto_id = ?")
    .all(produto.id) as Array<{ material: string; quantidade: number }>;

  for (const item of receita) {
    const estoque = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(item.material) as { quantidade: number } | undefined;
    const disponivel = estoque?.quantidade ?? 0;
    const necessario = item.quantidade * quantidadeProducoes;
    if (disponivel < necessario) {
      await interaction.reply({ content: `Estoque insuficiente de **${item.material}**. Precisa ${necessario}, tem ${disponivel}.`, ephemeral: true });
      return;
    }
  }

  const municoesGeradas = quantidadeProducoes * MUNICOES_POR_PRODUCAO;

  db.transaction(() => {
    for (const item of receita) {
      const necessario = item.quantidade * quantidadeProducoes;
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(necessario, item.material);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(item.material, -necessario, "producao", `Producao de ${quantidadeProducoes}x ${tipoMunicao}`, discordId);
    }

    const existeMunicao = db.prepare("SELECT id FROM estoque WHERE material = ?").get(tipoMunicao);
    if (existeMunicao) {
      db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = ?").run(municoesGeradas, tipoMunicao);
    } else {
      db.prepare("INSERT INTO estoque (material, quantidade) VALUES (?, ?)").run(tipoMunicao, municoesGeradas);
    }
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(tipoMunicao, municoesGeradas, "producao", `Fabricado por ${membro.nome}`, discordId);
    db.prepare("INSERT INTO producao_log (membro_discord_id, produto, quantidade_producoes, municoes_geradas) VALUES (?, ?, ?, ?)").run(discordId, tipoMunicao, quantidadeProducoes, municoesGeradas);
  })();

  const receitaTexto = receita.map((r) => `${r.quantidade * quantidadeProducoes} ${r.material}`).join(" | ");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Producao Concluida!")
        .addFields(
          { name: "Tipo", value: tipoMunicao.toUpperCase(), inline: true },
          { name: "Producoes", value: `${quantidadeProducoes}x`, inline: true },
          { name: "Municoes geradas", value: `${municoesGeradas}`, inline: true },
          { name: "Materiais usados", value: receitaTexto },
        )
        .setFooter({ text: `Fabricado por ${membro.nome}` })
        .setTimestamp(),
    ],
  });
}

async function ajuste(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode ajustar o estoque.", ephemeral: true });
    return;
  }

  const material = interaction.options.getString("material", true);
  const quantidade = interaction.options.getInteger("quantidade", true);
  const motivo = interaction.options.getString("motivo", true);

  const item = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(material) as { quantidade: number } | undefined;
  if (!item) {
    await interaction.reply({ content: `Material **${material}** nao encontrado.`, ephemeral: true });
    return;
  }

  const novaQtd = item.quantidade + quantidade;
  if (novaQtd < 0) {
    await interaction.reply({ content: `Quantidade insuficiente. Estoque: ${item.quantidade}, ajuste: ${quantidade}.`, ephemeral: true });
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE estoque SET quantidade = ? WHERE material = ?").run(novaQtd, material);
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(material, quantidade, "ajuste", motivo, discordId);
    registrarAuditoria("estoque_ajuste", discordId, material, `${quantidade > 0 ? "+" : ""}${quantidade} — ${motivo}`);
  })();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(quantidade > 0 ? 0x2ecc71 : 0xe74c3c)
        .setTitle("Estoque Ajustado")
        .addFields(
          { name: "Material", value: material, inline: true },
          { name: "Ajuste", value: `${quantidade > 0 ? "+" : ""}${quantidade}`, inline: true },
          { name: "Novo total", value: `${novaQtd}`, inline: true },
          { name: "Motivo", value: motivo },
        )
        .setFooter({ text: `Por ${admin.nome}` })
        .setTimestamp(),
    ],
  });
}

const HISTORICO_POR_PAGINA = 5;

async function historico(interaction: ChatInputCommandInteraction) {
  const total = (db.prepare("SELECT COUNT(*) as total FROM estoque_log").get() as { total: number }).total;

  if (total === 0) {
    await interaction.reply({ content: "Nenhuma movimentacao registrada.", ephemeral: true });
    return;
  }

  const totalPaginas = Math.ceil(total / HISTORICO_POR_PAGINA);
  let pagina = 0;

  const buildEmbed = (pag: number) => {
    const offset = pag * HISTORICO_POR_PAGINA;
    const logs = db
      .prepare("SELECT material, quantidade, tipo, descricao, criado_em FROM estoque_log ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(HISTORICO_POR_PAGINA, offset) as Array<{ material: string; quantidade: number; tipo: string; descricao: string | null; criado_em: string }>;

    let texto = "";
    for (const log of logs) {
      const sinal = log.quantidade > 0 ? "+" : "";
      const emoji = log.tipo === "entrada" ? "📥" : log.tipo === "producao" ? "🔨" : log.tipo === "venda" ? "🛒" : "📤";
      texto += `${emoji} **${log.material}** ${sinal}${log.quantidade} — ${log.descricao ?? log.tipo} (${log.criado_em})\n`;
    }

    return new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("Historico do Estoque")
      .setDescription(texto)
      .setFooter({ text: `Pagina ${pag + 1} de ${totalPaginas}` })
      .setTimestamp();
  };

  const buildRow = (pag: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("estoque_anterior").setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(pag === 0),
      new ButtonBuilder().setCustomId("estoque_proximo").setLabel("Próximo ▶").setStyle(ButtonStyle.Secondary).setDisabled(pag >= totalPaginas - 1),
    );

  const reply = await interaction.reply({ embeds: [buildEmbed(pagina)], components: totalPaginas > 1 ? [buildRow(pagina)] : [], fetchReply: true });
  if (totalPaginas <= 1) return;

  const collector = reply.createMessageComponentCollector({ time: 60000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) { await btn.reply({ content: "Apenas quem usou o comando pode navegar.", ephemeral: true }); return; }
    if (btn.customId === "estoque_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildEmbed(pagina)], components: [buildRow(pagina)] });
  });
  collector.on("end", async () => { await interaction.editReply({ components: [] }); });
}
