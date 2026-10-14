# Mavuri — Monitor Oracle ARM + alerta privado no Telegram

O workflow GitHub Actions consulta a capacidade para **VM.Standard.A1.Flex (1 OCPU, 4 GB RAM)** em **São Paulo, AD1**, a cada **15 minutos** (minutos 03, 18, 33 e 48 de cada hora). O GitHub pode atrasar ou suspender agendamentos.

**Somente consulta e notificação.** Este código não executa PLAN, APPLY, não lança instâncias nem cria rede ou disco. A criação da VM é manual na Oracle. ENABLE_APPLY deve permanecer false; se for diferente disso, o monitor para por segurança.

## Configuração existente no GitHub

Em Settings → Secrets and variables → Actions, já devem estar cadastrados:

**Secrets OCI:** OCI_USER_OCID, OCI_TENANCY_OCID, OCI_FINGERPRINT, OCI_PRIVATE_KEY_PEM.

**Variables:** OCI_STACK_OCID (Stack mavuri-waha), OCI_COMPARTMENT_OCID (root) e ENABLE_APPLY (false).

## 1. Configurar bot privado para alertas

Crie preferencialmente um bot Telegram exclusivo para alertas Oracle, separado do bot de ofertas, em [@BotFather](https://t.me/BotFather) usando /newbot. Não divulgue o token em prints, código ou nesta conversa.

Inicie conversa privada com o bot e envie /start. Descubra o chat ID numérico da conversa usando o método getUpdates da Bot API; evite compartilhar o URL que contém seu token ou a resposta completa.

Cadastre **dois Repository Secrets** no GitHub:
- MAVURI_ARM_TELEGRAM_BOT_TOKEN: token do novo bot.
- MAVURI_ARM_TELEGRAM_CHAT_ID: ID numérico da conversa privada.

O workflow só executa as consultas quando os secrets Telegram e Oracle estiverem configurados.

## 2. Enviar teste de mensagem

GitHub → Actions → Mavuri | Capacidade Oracle ARM → Run workflow.
Escolha main; marque **Enviar mensagem TESTE ao Telegram** e execute.

O teste envia mensagem contendo TESTE e não consulta nem altera a Oracle. Se não chegar, revise token, chat ID e se o bot recebeu /start.

## 3. Monitoramento automático

O workflow roda a cada 15 minutos, sujeito à fila do GitHub. Só notifica quando a Oracle reportar AVAILABLE com uma vaga ou contagem de vagas não informada. O aviso contém link para a Stack da Oracle e instrução para tentar criar manualmente a VM. Se a VM já existir, não há alerta.

Para evitar spam, o histórico de alertas é armazenado pelo GitHub Actions Cache: um alerta em até seis horas enquanto disponível, com possibilidade de notificar em transições após intervalo mínimo de uma hora. O GitHub pode remover caches, portanto não é garantia absoluta contra repetição.

O relatório de capacidade não reserva a máquina e pode mudar rapidamente.

## 4. Segurança IAM

A política mavuri-oracle-watcher-apply não é mais necessária. Revogue/remova as permissões PLAN/APPLY de gerenciamento de Jobs antes de usar o monitor em definitivo. A política mavuri-oracle-watcher-read já permite a consulta da Stack, existência da VM e capacidade ARM. O monitor não necessita de manage orm-jobs.

Não envie credenciais ou arquivos PEM por chat. Ao criar a VM manualmente, confira previamente a franquia Always Free e limites de armazenamento/disco. O monitor nunca envia pedido de criação.
