const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "pedidos.json");

const STATUS_VALIDOS = ["novo", "preparo", "concluido", "cancelado"];

async function lerPedidos() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(DATA_FILE, "[]", "utf8");
      return [];
    }
    throw err;
  }
}

async function salvarPedidos(pedidos) {
  await fs.writeFile(DATA_FILE, JSON.stringify(pedidos, null, 2), "utf8");
}

function ordenarMaisNovoPrimeiro(pedidos) {
  return [...pedidos].sort((a, b) => {
    const ta = new Date(a.criadoEm || 0).getTime();
    const tb = new Date(b.criadoEm || 0).getTime();
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/pedidos", async (req, res) => {
  try {
    const pedidos = await lerPedidos();
    res.json(ordenarMaisNovoPrimeiro(pedidos));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível listar os pedidos." });
  }
});

app.get("/api/pedidos/novos", async (req, res) => {
  try {
    const pedidos = await lerPedidos();
    const novos = pedidos.filter((p) => p.status === "novo");
    res.json(ordenarMaisNovoPrimeiro(novos));
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
      criadoEm: agora,
      createdAt: agora,
      status: "novo",
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
    console.log("Pedido criado:", { id: novo.id, createdAt: novo.createdAt });
    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível criar o pedido." });
  }
});

app.patch("/api/pedidos/:id/status", async (req, res) => {
  try {
    const { status } = req.body || {};
    if (typeof status !== "string" || !STATUS_VALIDOS.includes(status)) {
      return res.status(400).json({
        erro: `Status inválido. Use: ${STATUS_VALIDOS.join(", ")}.`,
      });
    }

    const pedidos = await lerPedidos();
    const idParam = req.params.id;
    const idx = pedidos.findIndex(
      (p) => String(p.id) === String(idParam)
    );

    if (idx === -1) {
      return res.status(404).json({ erro: "Pedido não encontrado." });
    }

    pedidos[idx].status = status;
    await salvarPedidos(pedidos);
    res.json(pedidos[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível atualizar o status." });
  }
});

app.listen(PORT, () => {
  console.log(`API pedidos online em http://localhost:${PORT}`);
});
