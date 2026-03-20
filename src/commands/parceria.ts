import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, CARGOS_GERENCIA } from "../utils/semana";

type Parceria = {
  id: number;
  nome: string;
  tipo: string;
  desconto_percent: number;
  contato_discord_id: string | null;
  observacoes: string | null;
  ativo: number;
  criado_em: string;
};

const TIPO_LABEL: Record<string, string> = {
  comprador: "🛒 Comprador",
  fornecedor: "📦 Fornecedor",
  mutuo: "🤝 Mútuo",
};

export const data = new SlashCommandBuilder()
  .setName("parceria")
  .setDescription("Gerenciamento de parcerias")
  .addSubcommand((sub) =>
    sub
      .setName("adicionar")
      .setDescription("Cadastrar nova parceria (admin)")
      .addStringOption((opt) =>
        opt.setName("nome").setDescription("Nome da organização/pessoa parceira").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("tipo")
          .setDescription("Tipo da parceria")
          .setRequired(true)
          .addChoices(
            { name: "🛒 Comprador (nos compra)", value: "comprador" },
            { name: "📦 Fornecedor (nos vende)", value: "fornecedor" },
            { name: "🤝 Mútuo (ambos)", value: "mutuo" },
          ),
      )
      .addIntegerOption((opt) =>
        opt.setName("desconto").setDescription("Desconto aplicado em % (ex: 10 = 10%)").setRequired(true).setMinValue(0).setMaxValue(100),
      )
      .addUserOption((opt) =>
        opt.setName("contato").setDescription("Usuário do Discord do contato (opcional)").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("observacoes").setDescription("Detalhes do acordo (opcional)").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remover")
      .setDescription("Desativar uma parceria (admin)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID da parceria (ver em /parceria listar)").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("editar")
      .setDescription("Editar uma parceria existente (admin)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID da parceria").setRequired(true).setMinValue(1),
      )
      .addStringOption((opt) =>
        opt.setName("nome").setDescription("Novo nome").setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName("tipo")
          .setDescription("Novo tipo")
          .setRequired(false)
          .addChoices(
            { name: "🛒 Comprador", value: "comprador" },
            { name: "📦 Fornecedor", value: "fornecedor" },
            { name: "🤝 Mútuo", value: "mutuo" },
          ),
      )
      .addIntegerOption((opt) =>
        opt.setName("desconto").setDescription("Novo desconto em %").setRequired(false).setMinValue(0).setMaxValue(100),
      )
      .addUserOption((opt) =>
        opt.setName("contato").setDescription("Novo contato do Discord").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("observacoes").setDescription("Novas observações").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("listar").setDescription("Listar todas as parcerias ativas (gerencia)"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ver")
      .setDescription("Ver detalhes de uma parceria (gerencia)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID da parceria").setRequired(true).setMinValue(1),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  const membro = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string } | undefined;

  const isAdmin = membro && CARGOS_ADMIN.includes(membro.cargo.toLowerCase());
  const isGerencia = membro && CARGOS_GERENCIA.includes(membro.cargo.toLowerCase());

  if (["adicionar", "remover", "editar"].includes(sub) && !isAdmin) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode gerenciar parcerias.", ephemeral: true });
    return;
  }

  if (["listar", "ver"].includes(sub) && !isGerencia) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode ver as parcerias.", ephemeral: true });
    return;
  }

  if (sub === "adicionar") await adicionar(interaction);
  else if (sub === "remover") await remover(interaction);
  else if (sub === "editar") await editar(interaction);
  else if (sub === "listar") await listar(interaction);
  else if (sub === "ver") await ver(interaction);
}

async function adicionar(interaction: ChatInputCommandInteraction) {
  const nome = interaction.options.getString("nome", true);
  const tipo = interaction.options.getString("tipo", true);
  const desconto = interaction.options.getInteger("desconto", true);
  const contato = interaction.options.getUser("contato");
  const observacoes = interaction.options.getString("observacoes");

  const existente = db.prepare("SELECT id FROM parcerias WHERE nome = ? AND ativo = 1").get(nome);
  if (existente) {
    await interaction.reply({ content: `Já existe uma parceria ativa com o nome **${nome}**.`, ephemeral: true });
    return;
  }

  const result = db.prepare(
    "INSERT INTO parcerias (nome, tipo, desconto_percent, contato_discord_id, observacoes) VALUES (?, ?, ?, ?, ?)",
  ).run(nome, tipo, desconto, contato?.id ?? null, observacoes ?? null);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Parceria Adicionada")
    .addFields(
      { name: "ID", value: `#${result.lastInsertRowid}`, inline: true },
      { name: "Nome", value: nome, inline: true },
      { name: "Tipo", value: TIPO_LABEL[tipo] ?? tipo, inline: true },
      { name: "Desconto", value: `${desconto}%`, inline: true },
      { name: "Contato", value: contato ? `<@${contato.id}>` : "Não informado", inline: true },
      { name: "Observações", value: observacoes ?? "Nenhuma", inline: false },
    )
    .setFooter({ text: `Adicionado por ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function remover(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger("id", true);

  const parceria = db.prepare("SELECT * FROM parcerias WHERE id = ? AND ativo = 1").get(id) as Parceria | undefined;

  if (!parceria) {
    await interaction.reply({ content: `Parceria **#${id}** não encontrada ou já está inativa.`, ephemeral: true });
    return;
  }

  db.prepare("UPDATE parcerias SET ativo = 0 WHERE id = ?").run(id);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("Parceria Removida")
    .setDescription(`A parceria com **${parceria.nome}** foi desativada.`)
    .setFooter({ text: `Removido por ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function editar(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger("id", true);

  const parceria = db.prepare("SELECT * FROM parcerias WHERE id = ? AND ativo = 1").get(id) as Parceria | undefined;

  if (!parceria) {
    await interaction.reply({ content: `Parceria **#${id}** não encontrada ou inativa.`, ephemeral: true });
    return;
  }

  const nome = interaction.options.getString("nome") ?? parceria.nome;
  const tipo = interaction.options.getString("tipo") ?? parceria.tipo;
  const desconto = interaction.options.getInteger("desconto") ?? parceria.desconto_percent;
  const contato = interaction.options.getUser("contato");
  const contatoId = contato ? contato.id : parceria.contato_discord_id;
  const observacoes = interaction.options.getString("observacoes") ?? parceria.observacoes;

  db.prepare(
    "UPDATE parcerias SET nome = ?, tipo = ?, desconto_percent = ?, contato_discord_id = ?, observacoes = ? WHERE id = ?",
  ).run(nome, tipo, desconto, contatoId, observacoes, id);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Parceria Editada")
    .addFields(
      { name: "ID", value: `#${id}`, inline: true },
      { name: "Nome", value: nome, inline: true },
      { name: "Tipo", value: TIPO_LABEL[tipo] ?? tipo, inline: true },
      { name: "Desconto", value: `${desconto}%`, inline: true },
      { name: "Contato", value: contatoId ? `<@${contatoId}>` : "Não informado", inline: true },
      { name: "Observações", value: observacoes ?? "Nenhuma", inline: false },
    )
    .setFooter({ text: `Editado por ${interaction.user.displayName}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function listar(interaction: ChatInputCommandInteraction) {
  const parcerias = db
    .prepare("SELECT * FROM parcerias WHERE ativo = 1 ORDER BY tipo, nome")
    .all() as Parceria[];

  if (parcerias.length === 0) {
    await interaction.reply({ content: "Nenhuma parceria ativa no momento.", ephemeral: true });
    return;
  }

  let texto = "";
  let tipoAtual = "";

  for (const p of parcerias) {
    if (p.tipo !== tipoAtual) {
      tipoAtual = p.tipo;
      texto += `\n**— ${TIPO_LABEL[p.tipo] ?? p.tipo} —**\n`;
    }
    const contato = p.contato_discord_id ? ` | <@${p.contato_discord_id}>` : "";
    texto += `\`#${p.id}\` **${p.nome}** — ${p.desconto_percent}% desconto${contato}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🤝 Parcerias Ativas (${parcerias.length})`)
    .setDescription(texto)
    .setFooter({ text: "Use /parceria ver <id> para mais detalhes" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function ver(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger("id", true);

  const parceria = db.prepare("SELECT * FROM parcerias WHERE id = ?").get(id) as Parceria | undefined;

  if (!parceria) {
    await interaction.reply({ content: `Parceria **#${id}** não encontrada.`, ephemeral: true });
    return;
  }

  const status = parceria.ativo ? "✅ Ativa" : "❌ Inativa";

  const embed = new EmbedBuilder()
    .setColor(parceria.ativo ? 0x2ecc71 : 0x95a5a6)
    .setTitle(`🤝 Parceria #${parceria.id} — ${parceria.nome}`)
    .addFields(
      { name: "Status", value: status, inline: true },
      { name: "Tipo", value: TIPO_LABEL[parceria.tipo] ?? parceria.tipo, inline: true },
      { name: "Desconto", value: `${parceria.desconto_percent}%`, inline: true },
      { name: "Contato", value: parceria.contato_discord_id ? `<@${parceria.contato_discord_id}>` : "Não informado", inline: true },
      { name: "Cadastrada em", value: parceria.criado_em.split(" ")[0], inline: true },
      { name: "Observações", value: parceria.observacoes ?? "Nenhuma", inline: false },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
