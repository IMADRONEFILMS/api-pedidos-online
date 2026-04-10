const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "pedidos.json");

const STATUS_OFICIAIS = new Set(["novo", "preparo", "concluido", "cancelado"]);

const MAPEAMENTO_STATUS = {
  pendente: "novo",
  pending: "novo",
  aguardando: "novo",
  em_preparo: "preparo",
  empreparo: "preparo",
  preparando: "preparo",
  cozinha: "preparo",
  em_andamento: "preparo",
  pronto: "concluido",
  entregue: "concluido",
  finalizado: "concluido",
  feito: "concluido",
  concluida: "concluido",
  cancelada: "cancelado",
  cancelled: "cancelado",
};

const CHAVES_RESPOSTA_PRIORITARIAS = [
  "id",
  "createdAt",
  "status",
  "statusUpdatedAt",
  "preparingAt",
  "completedAt",
  "cancelledAt",
  "printedAt",
];

function chaveStatusNormalizada(valor) {
  return String(valor).trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizarStatus(valor, contexto) {
  const ctx = contexto || "desconhecido";
  if (valor === undefined || valor === null || String(valor).trim() === "") {
    console.warn(`[status] valor vazio (${ctx}), usando "novo".`);
    return { status: "novo" };
  }
  const chave = chaveStatusNormalizada(valor);
  if (STATUS_OFICIAIS.has(chave)) {
    return { status: chave };
  }
  if (MAPEAMENTO_STATUS[chave]) {
    return { status: MAPEAMENTO_STATUS[chave], de: chave };
  }
  console.warn(
    `[status] desconhecido "${valor}" (${ctx}), fallback controlado "novo".`
  );
  return { status: "novo", fallbackDesconhecido: true, bruto: valor };
}

function respostaPedido(p) {
  if (!p || typeof p !== "object") return p;
  const out = Object.create(null);
  for (const k of CHAVES_RESPOSTA_PRIORITARIAS) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  }
  for (const k of Object.keys(p)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = p[k];
  }
  return out;
}

function respostaPedidos(lista) {
  return lista.map(respostaPedido);
}

async function lerPedidos() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : [];
    let dirty = false;
    for (const pedido of arr) {
      const { mudou, ajustes } = normalizarPedidoPersistido(pedido);
      if (mudou) dirty = true;
      if (ajustes.length) {
        console.log("Pedido normalizado:", {
          id: pedido.id,
          ajustes: ajustes.join(" | "),
        });
      }
    }
    if (dirty) await salvarPedidos(arr);
    return arr;
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(DATA_FILE, "[]", "utf8");
      return [];
    }
    throw err;
  }
}

function normalizarPedidoPersistido(p) {
  const ajustes = [];
  let mudou = false;

  const marcar = (msg) => {
    ajustes.push(msg);
    mudou = true;
  };

  const statusAntes = p.status;
  const normStatus = normalizarStatus(statusAntes, "pedido persistido");
  if (p.status !== normStatus.status) {
    marcar(`status: ${JSON.stringify(statusAntes)} → ${normStatus.status}`);
    p.status = normStatus.status;
  }

  if (!p.createdAt) {
    if (p.criadoEm) {
      p.createdAt = p.criadoEm;
      marcar("createdAt ← criadoEm");
    } else if (p.statusUpdatedAt) {
      p.createdAt = p.statusUpdatedAt;
      marcar("createdAt ← statusUpdatedAt");
    } else {
      const fallback = new Date().toISOString();
      p.createdAt = fallback;
      marcar("createdAt (fallback ausente)");
      console.warn(
        "[persistência] pedido sem createdAt/criadoEm/statusUpdatedAt; id:",
        p.id
      );
    }
  }

  if (!p.criadoEm && p.createdAt) {
    p.criadoEm = p.createdAt;
    marcar("criadoEm ← createdAt");
  }

  if (!p.statusUpdatedAt) {
    p.statusUpdatedAt = p.createdAt || p.criadoEm;
    marcar("statusUpdatedAt ← createdAt");
  }

  if (p.status === "preparo" && p.preparingAt == null) {
    p.preparingAt = p.statusUpdatedAt;
    marcar("preparingAt ← statusUpdatedAt");
  }
  if (p.status === "concluido" && p.completedAt == null) {
    p.completedAt = p.statusUpdatedAt;
    marcar("completedAt ← statusUpdatedAt");
  }
  if (p.status === "cancelado" && p.cancelledAt == null) {
    p.cancelledAt = p.statusUpdatedAt;
    marcar("cancelledAt ← statusUpdatedAt");
  }

  return { mudou, ajustes };
}

async function salvarPedidos(pedidos) {
  await fs.writeFile(DATA_FILE, JSON.stringify(pedidos, null, 2), "utf8");
}

function ordenarMaisNovoPrimeiro(pedidos) {
  return [...pedidos].sort((a, b) => {
    const ta = new Date(a.createdAt || a.criadoEm || 0).getTime();
    const tb = new Date(b.createdAt || b.criadoEm || 0).getTime();
    return tb - ta;
  });
}

function gerarIdUnico(pedidos) {
  const existentes = new Set(pedidos.map((p) => String(p.id)));
  let id;
  do {
    id = randomUUID();
  } while (existentes.has(id));
  return id;
}

function temCliente(cliente) {
  if (cliente === undefined || cliente === null) return false;
  if (typeof cliente === "string") return cliente.trim().length > 0;
  if (typeof cliente === "object") return Object.keys(cliente).length > 0;
  return true;
}

function itensValidos(itens) {
  return Array.isArray(itens) && itens.length >= 1;
}

function aplicarMudancaStatus(pedido, novoStatus, agora) {
  const anterior = pedido.status;
  pedido.status = novoStatus;
  pedido.statusUpdatedAt = agora;

  if (novoStatus === "preparo" && pedido.preparingAt == null) {
    pedido.preparingAt = agora;
  }
  if (novoStatus === "concluido" && pedido.completedAt == null) {
    pedido.completedAt = agora;
  }
  if (novoStatus === "cancelado" && pedido.cancelledAt == null) {
    pedido.cancelledAt = agora;
  }

  return anterior;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/pedidos", async (req, res) => {
  try {
    const pedidos = await lerPedidos();
    res.json(respostaPedidos(ordenarMaisNovoPrimeiro(pedidos)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível listar os pedidos." });
  }
});

app.get("/api/pedidos/novos", async (req, res) => {
  try {
    const pedidos = await lerPedidos();
    const novos = pedidos.filter((p) => p.status === "novo");
    res.json(respostaPedidos(ordenarMaisNovoPrimeiro(novos)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível listar os pedidos novos." });
  }
});

app.post("/api/pedidos", async (req, res) => {
  try {
    const body = req.body || {};

    if (!temCliente(body.cliente)) {
      return res.status(400).json({ erro: "Cliente é obrigatório." });
    }
    if (!itensValidos(body.itens)) {
      return res
        .status(400)
        .json({ erro: "Informe um array itens com pelo menos um item." });
    }

    const pedidos = await lerPedidos();
    const agora = new Date().toISOString();
    const novo = {
      id: gerarIdUnico(pedidos),
      createdAt: agora,
      criadoEm: agora,
      status: "novo",
      statusUpdatedAt: agora,
      cliente: body.cliente,
      tipoPedido: body.tipoPedido,
      endereco: body.endereco,
      pagamento: body.pagamento,
      trocoPara: body.trocoPara,
      observacao: body.observacao,
      taxaEntrega: body.taxaEntrega,
      total: body.total,
      itens: body.itens,
    };

    pedidos.push(novo);
    await salvarPedidos(pedidos);
    console.log("Pedido criado:", {
      id: novo.id,
      createdAt: novo.createdAt,
      status: novo.status,
    });
    res.status(201).json(respostaPedido(novo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível criar o pedido." });
  }
});

app.patch("/api/pedidos/:id/status", async (req, res) => {
  try {
    const { status } = req.body || {};
    if (typeof status !== "string") {
      return res.status(400).json({
        erro: "Campo status (string) é obrigatório.",
      });
    }

    const norm = normalizarStatus(status, "PATCH /api/pedidos/:id/status");
    const novoStatus = norm.status;

    const pedidos = await lerPedidos();
    const idParam = req.params.id;
    const idx = pedidos.findIndex((p) => String(p.id) === String(idParam));

    if (idx === -1) {
      return res.status(404).json({ erro: "Pedido não encontrado." });
    }

    const agora = new Date().toISOString();
    const statusAnterior = aplicarMudancaStatus(pedidos[idx], novoStatus, agora);

    await salvarPedidos(pedidos);
    console.log("Status alterado:", {
      id: pedidos[idx].id,
      statusAnterior,
      statusNovo: novoStatus,
      statusUpdatedAt: agora,
    });
    res.json(respostaPedido(pedidos[idx]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível atualizar o status." });
  }
});

app.listen(PORT, () => {
  console.log(`API pedidos online em http://localhost:${PORT}`);
});
