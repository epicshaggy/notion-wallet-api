const express = require("express");
const { Client } = require("@notionhq/client");
const formatISO = require("date-fns/formatISO");
// import { Client } from "@notionhq/client";

const app = express();

const port = 3000;

function getNotionClient(token) {
  const client = new Client({ auth: token });
  return client;
}

async function getDatabaseIdByName(dbName, client) {
  const response = await client
    .search({
      query: dbName,
      filter: { property: "object", value: "database" },
    })
    .catch(() => null);
  return response?.results[0]?.id;
}

async function getExpenses(client) {
  const database_id = await getDatabaseIdByName("Expenses", client).catch(
    () => null
  );
  if (!database_id) {
    return;
  }

  const queryProps = ["Description", "Date", "Amount"];
  const filter = {
    and: [
      {
        property: "Status",
        select: {
          equals: "Pending",
        },
      },
      {
        property: "Date",
        date: {
          on_or_before: formatISO(new Date(), { representation: "date" }),
        },
      },
    ],
  };

  let response = await client.databases
    .query({
      database_id,
      filter,
    })
    .catch(() => null);

  if (!response?.results?.length) {
    response = { pages: [] };
  } else {
    const pages = [];
    for (const entry of response.results) {
      const properties = {};
      for (const property in entry.properties) {
        if (queryProps.includes(property)) {
          const propId = entry.properties[property].id;

          properties[property] = entry.properties[property];

          let value = await getPropertyValue(entry.id, propId, client);
          switch (property) {
            case "Date":
              const dateStr = value.date.start;
              value = new Date(dateStr);
              break;
            case "Amount":
              value = value.number;
              break;
            case "Description":
              value = value.results[0]?.title?.text?.content;
              break;
            default:
              value = "";
              //   value = undefined;
              break;
          }

          properties[property].value = value;
        }
      }
      pages.push({ ...properties, id: entry.id });
    }
    response = { pages };
  }

  return response;
}

async function getPropertyValue(page_id, property_id, client) {
  const response = await client.pages.properties.retrieve({
    page_id,
    property_id,
  });
  return response;
}

app.get("/", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const dbId = await getDatabaseIdByName("Expenses", client);

  if (!dbId) {
    res.status(404).send("Database not found");
    return;
  }

  const entries = await getExpenses(dbId, client).catch(() => null);
  res.send(entries);
});

app.get("/expenses", async (req, res) => {
  const token = req.query.token;
  const client = getNotionClient(token);
  const response = await getExpenses(client).catch(() => null);
  if (!response) {
    res.status(404).send();
    return;
  }

  res.send(response);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});