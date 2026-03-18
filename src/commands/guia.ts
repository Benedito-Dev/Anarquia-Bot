import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("guia")
  .setDescription("Guia completo para iniciantes sobre como funciona a familia");

export async function execute(interaction: ChatInputCommandInteraction) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("guia_menu")
    .setPlaceholder("Escolha um topico")
    .addOptions(
      { label: "📋 Visao Geral", value: "visao_geral", description: "Como funciona a familia" },
      { label: "🌾 Farm", value: "farm", description: "Sistema de farm e metas" },
      { label: "💵 Dinheiro Sujo", value: "dinheiro", description: "Como funciona dinheiro sujo" },
      { label: "🛒 Vendas", value: "vendas", description: "Sistema de vendas" },
      { label: "⚔️ Acoes", value: "acoes", description: "Como funcionam as acoes" },
      { label: "💰 Caixa e Dividas", value: "caixa", description: "Sistema de caixa e dividas" },
      { label: "📊 Cargos e Hierarquia", value: "cargos", description: "Estrutura da familia" },
      { label: "🎯 Metas e Bonus", value: "metas", description: "Sistema de metas e bonus" },
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📚 Guia da Familia Anarquia")
    .setDescription(
      "Bem-vindo ao guia completo da familia!\n\n" +
        "Use o menu abaixo para escolher um topico e aprender como tudo funciona.\n\n" +
        "Se tiver duvidas, fale com a lideranca!",
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], components: [row] });

  const collector = interaction.channel?.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId === "guia_menu",
    time: 300000,
  });

  collector?.on("collect", async (i: StringSelectMenuInteraction) => {
    const topico = i.values[0];
    const embedResposta = getTopicoEmbed(topico);
    await i.update({ embeds: [embedResposta], components: [row] });
  });
}

function getTopicoEmbed(topico: string): EmbedBuilder {
  switch (topico) {
    case "visao_geral":
      return new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("📋 Visao Geral")
        .setDescription(
          "A familia Anarquia funciona como uma organizacao economica no servidor.\n\n" +
            "**Principais atividades:**\n" +
            "🌾 **Farm** — Coletar cobres e aluminios\n" +
            "💵 **Dinheiro Sujo** — Lavar dinheiro sujo\n" +
            "🛒 **Vendas** — Vender produtos (C4, cartoes, etc)\n" +
            "⚔️ **Acoes** — Participar de acoes da familia\n\n" +
            "**Como ganhar dinheiro:**\n" +
            "• Farm paga 5% do valor base do C4\n" +
            "• Dinheiro sujo paga 10% do valor entregue\n" +
            "• Vendas pagam 50% do lucro\n" +
            "• Acoes pagam conforme divisao\n" +
            "• Bonus semanais por produtividade\n\n" +
            "Use `/farm`, `/dinheiro`, `/venda` para registrar suas atividades!",
        )
        .setTimestamp();

    case "farm":
      return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🌾 Farm")
        .setDescription(
          "**Como funciona:**\n" +
            "1. Colete cobres e aluminios no servidor\n" +
            "2. Use `/farm registrar` para registrar sua entrega\n" +
            "3. Receba 5% do valor base do C4 (media ~R$370 por C4 equivalente)\n\n" +
            "**Metas diarias:**\n" +
            "• Iniciante ate Gerente: **200 cobres/dia**\n" +
            "• Sublider e Lider: sem meta\n\n" +
            "**Metas semanais:**\n" +
            "• Iniciante: 400 cobres\n" +
            "• Membro: 800 cobres\n" +
            "• Farmer Veterano: 1200 cobres\n" +
            "• Gerente: 1400 cobres\n\n" +
            "**Comandos:**\n" +
            "`/farm registrar` — Registrar entrega\n" +
            "`/farm ranking` — Ver ranking da semana\n" +
            "`/farm metas` — Ver suas metas\n" +
            "`/farm historico` — Ver seu historico",
        )
        .setTimestamp();

    case "dinheiro":
      return new EmbedBuilder()
        .setColor(0x27ae60)
        .setTitle("💵 Dinheiro Sujo")
        .setDescription(
          "**Como funciona:**\n" +
            "1. Lave dinheiro sujo no servidor\n" +
            "2. Use `/dinheiro registrar` para registrar\n" +
            "3. Receba 10% do valor lavado\n\n" +
            "**Meta diaria:**\n" +
            "• Iniciante ate Gerente: **$50.000/dia**\n" +
            "• Sublider e Lider: sem meta\n\n" +
            "**Bonus semanais:**\n" +
            "• $200.000+ na semana: +$10.000\n" +
            "• $350.000+ na semana: +$25.000\n" +
            "• $500.000+ na semana: +$50.000\n\n" +
            "**Comandos:**\n" +
            "`/dinheiro registrar` — Registrar lavagem\n" +
            "`/dinheiro ranking` — Ver ranking\n" +
            "`/dinheiro metas` — Ver suas metas\n" +
            "`/dinheiro ganhos` — Ver seus ganhos",
        )
        .setTimestamp();

    case "vendas":
      return new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("🛒 Vendas")
        .setDescription(
          "**Como funciona:**\n" +
            "1. Venda produtos da familia (C4, cartoes, etc)\n" +
            "2. Use `/venda registrar` para registrar\n" +
            "3. Receba 50% do lucro da venda\n" +
            "4. Os outros 50% viram divida com o caixa\n\n" +
            "**Sistema de divida:**\n" +
            "• Ao vender, voce recebe 50% na hora\n" +
            "• Os outros 50% ficam como divida\n" +
            "• Use `/caixa depositar` para pagar a divida\n" +
            "• Veja sua divida com `/divida ver`\n\n" +
            "**Bonus de volume:**\n" +
            "• 50+ produtos vendidos na semana: +$10.000\n" +
            "• 100+ produtos vendidos na semana: +$25.000\n\n" +
            "**Comandos:**\n" +
            "`/venda registrar` — Registrar venda\n" +
            "`/venda historico` — Ver historico\n" +
            "`/divida ver` — Ver sua divida",
        )
        .setTimestamp();

    case "acoes":
      return new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("⚔️ Acoes")
        .setDescription(
          "**Como funciona:**\n" +
            "1. Participe de acoes organizadas pela lideranca\n" +
            "2. A lideranca registra a acao com `/acao registrar`\n" +
            "3. O dinheiro e dividido entre os participantes\n\n" +
            "**Tipos de acao:**\n" +
            "• **Com dinheiro** — Acao que gerou dinheiro (assaltos, etc)\n" +
            "• **Sem dinheiro** — Acao sem lucro (guerras, defesas)\n\n" +
            "**Divisao:**\n" +
            "• 50% vai para o caixa da familia\n" +
            "• 50% e dividido entre os participantes\n\n" +
            "**Comandos:**\n" +
            "`/acao historico` — Ver historico de acoes\n" +
            "`/acao participacoes` — Ver suas participacoes",
        )
        .setTimestamp();

    case "caixa":
      return new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("💰 Caixa e Dividas")
        .setDescription(
          "**Caixa da familia:**\n" +
            "O caixa e o dinheiro coletivo da familia.\n\n" +
            "**Entradas:**\n" +
            "• 50% das vendas (como divida)\n" +
            "• 50% das acoes\n" +
            "• Depositos de membros\n\n" +
            "**Saidas:**\n" +
            "• Pagamentos de farm (5%)\n" +
            "• Pagamentos de dinheiro sujo (10%)\n" +
            "• Bonus semanais\n" +
            "• Pagamento da lideranca\n\n" +
            "**Sistema de dividas:**\n" +
            "• Ao vender, 50% vira divida automaticamente\n" +
            "• Use `/caixa depositar` para pagar\n" +
            "• O deposito abate da divida primeiro\n" +
            "• Veja sua divida com `/divida ver`\n\n" +
            "**Comandos:**\n" +
            "`/caixa ver` — Ver saldo do caixa\n" +
            "`/caixa depositar` — Depositar/pagar divida\n" +
            "`/divida ver` — Ver sua divida",
        )
        .setTimestamp();

    case "cargos":
      return new EmbedBuilder()
        .setColor(0x34495e)
        .setTitle("📊 Cargos e Hierarquia")
        .setDescription(
          "**Hierarquia (do maior para o menor):**\n\n" +
            "👑 **Lider**\n" +
            "• Controle total da familia\n" +
            "• Sem metas\n\n" +
            "⭐ **Sublider**\n" +
            "• Administracao geral\n" +
            "• Sem metas\n\n" +
            "💼 **Gerente**\n" +
            "• Gerencia operacional\n" +
            "• Meta: 1400 cobres/semana + $50k/dia\n\n" +
            "🌾 **Farmer Veterano**\n" +
            "• Farmer experiente\n" +
            "• Meta: 1200 cobres/semana + $50k/dia\n\n" +
            "👤 **Membro**\n" +
            "• Membro estabelecido\n" +
            "• Meta: 800 cobres/semana + $50k/dia\n\n" +
            "🆕 **Iniciante**\n" +
            "• Novo na familia\n" +
            "• Meta: 400 cobres/semana + $50k/dia\n\n" +
            "**Promocoes:**\n" +
            "Fale com a lideranca sobre promocoes!",
        )
        .setTimestamp();

    case "metas":
      return new EmbedBuilder()
        .setColor(0x1abc9c)
        .setTitle("🎯 Metas e Bonus")
        .setDescription(
          "**Metas diarias:**\n" +
            "• Farm: 200 cobres\n" +
            "• Dinheiro: $50.000\n\n" +
            "**Metas semanais (farm):**\n" +
            "• Iniciante: 400 cobres\n" +
            "• Membro: 800 cobres\n" +
            "• Farmer Veterano: 1200 cobres\n" +
            "• Gerente: 1400 cobres\n\n" +
            "**Bonus de dinheiro sujo:**\n" +
            "• $200k+ na semana: +$10k\n" +
            "• $350k+ na semana: +$25k\n" +
            "• $500k+ na semana: +$50k\n\n" +
            "**Bonus de vendas:**\n" +
            "• 50+ produtos: +$10k\n" +
            "• 100+ produtos: +$25k\n\n" +
            "**Bonus de farm:**\n" +
            "• 2000+ cobres: +$10k\n" +
            "• 3500+ cobres: +$25k\n" +
            "• 5000+ cobres: +$50k\n\n" +
            "**Comandos:**\n" +
            "`/farm metas` — Ver metas de farm\n" +
            "`/dinheiro metas` — Ver metas de dinheiro\n" +
            "`/relatorio membro` — Ver seu relatorio completo",
        )
        .setTimestamp();

    default:
      return new EmbedBuilder().setColor(0x95a5a6).setTitle("Topico nao encontrado").setTimestamp();
  }
}
