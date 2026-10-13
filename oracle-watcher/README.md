# Mavuri — Monitor de capacidade Oracle ARM

Este módulo está isolado do restante de `mavuri-api-test` e usa o GitHub Actions para verificar, a cada 2 horas, a capacidade da instância **VM.Standard.A1.Flex (1 OCPU, 4 GB RAM)** em São Paulo. O computador do usuário pode permanecer desligado.

## Estado inicial

- O workflow `.github/workflows/mavuri-oci-capacity.yml` está no repositório público.
- **Sem credenciais:** os testes locais rodam; nenhuma consulta ou Apply é feito na Oracle.
- **Com credenciais e `ENABLE_APPLY=false`:** consultas de capacidade, sem Apply.
- **Com `ENABLE_APPLY=true`:** quando há capacidade, valida configuração SHA256 da Stack, ausência de VM existente, Jobs ativos, gera um Plan novo, exige *exatamente* uma VM A1 Flex 1 OCPU/4 GB e nenhum update/destroy; só então solicita um Apply a partir do plano validado.
- A configuração Terraform aprovada é identificada pelo SHA256 `edea25ba2af70f47a085861b217b6f56884b1b8034cf9e213154793ecd8aab57`.
- Isso **não garante capacidade**, nem dispensa verificação de cobrança/limites Always Free.

## 1. Criar uma identidade Oracle dedicada

Na Oracle Cloud, em **Identity & Security → Domains → Default → Users**, crie um usuário de automação, sem privilégios de administrador. Crie um grupo separado para ele e uma chave **API Signing Key** (diferente da chave SSH do Ubuntu).

Não envie chaves privadas neste chat ou para o código público. Guarde a PEM privada somente no **GitHub Actions Repository Secrets**.

### Políticas IAM

O usuário precisará de permissões mínimas para consultar relatórios e ler recursos, e de permissão de gerenciamento de Jobs, restrita aos Jobs PLAN/APPLY da Stack específica. As instruções definitivas devem ser testadas na tenancy, pois os detalhes do IAM dependem do domínio/compartimento; **não conceda Administrator, nem permissão DESTROY**.

Documentação oficial:
- [Core services IAM](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/corepolicyreference.htm)
- [Resource Manager IAM](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/resourcemanagerpolicyreference.htm)

## 2. Adicionar Secrets e Variables no GitHub

Abra `Settings → Secrets and variables → Actions` neste repositório.

**Secrets (não compartilhe os valores aqui):**
- `OCI_USER_OCID` — OCID do usuário de automação.
- `OCI_TENANCY_OCID` — OCID da tenancy Oracle.
- `OCI_FINGERPRINT` — fingerprint da chave de API.
- `OCI_PRIVATE_KEY_PEM` — conteúdo completo da chave privada PEM de API.

**Variables:**
- `OCI_STACK_OCID` — OCID da Stack `mavuri-waha`.
- `OCI_COMPARTMENT_OCID` — OCID da tenancy root (igual a `OCI_TENANCY_OCID`).
- `ENABLE_APPLY` — `false` no primeiro teste.

## 3. Testar antes de permitir criação

Execute primeiro a consulta normal em Actions com a opção **Validar permissao PLAN sem criar VM** desmarcada. Depois, com `ENABLE_APPLY=false`, execute manualmente o workflow mais uma vez **marcando** a opção `verify_plan`. Ela cria somente um Job PLAN na Stack, valida que o plano contém exatamente uma VM A1 Flex (1 OCPU/4 GB) e **nunca solicita Apply**, mesmo se `ENABLE_APPLY=true` por engano. Caso a configuração Terraform baixada da Stack não coincida com a assinatura aprovada, a execução é interrompida antes do Plan e do Apply para revisão.

Na aba **Actions**, abra **Mavuri | Capacidade Oracle ARM** e clique em **Run workflow**. Espere o resultado. Se a capacidade estiver esgotada, deve aparecer `OUT_OF_HOST_CAPACITY`, sem Terraform Apply.

Só depois de conferir autenticação, políticas, Stack e execução em modo consulta, altere `ENABLE_APPLY` para `true`, e acompanhe o próximo Job.

## Segurança e despesas

- O código contém **nenhuma chave de acesso ou segredo**.
- Workflow em repositório público usa runners padrão GitHub gratuitos; não troque para runners maiores sem avaliar custos.
- VM ARM A1 do modelo configurado está dentro da franquia de computação Always Free; demais limites de storage e recursos são compartilhados na tenancy. Configure alertas de orçamento e não faça upgrade para plano pago sem revisar.
- Desative a criação a qualquer momento com `ENABLE_APPLY=false`.
- O agendamento do GitHub não é um SLA: pode atrasar e pode ser suspenso após inatividade.
- Um relatório de capacidade `AVAILABLE` não reserva host; a tentativa de Apply pode novamente falhar.
- A conta API da automação deve ser exclusiva e ter IAM restrito. Um token roubado poderia ser usado independentemente das proteções do script se a permissão IAM for excessiva.
