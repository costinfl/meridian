import React, { useState } from "react";
import { Modal } from "./Modal.jsx";
import { C, btnStyle, hexA } from "../theme.js";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function ProjectManager({ projectList, currentProjectId, onClose, onCreate, onOpen, onDelete, onRename }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await onCreate(name);
    setNewName("");
    setCreating(false);
    onClose();
  };

  const handleRename = async (id) => {
    const name = renameValue.trim();
    if (name) await onRename(id, name);
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDelete = async (id) => {
    await onDelete(id);
    setConfirmDeleteId(null);
  };

  const rowBase = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "9px 10px", borderRadius: 3, marginBottom: 4,
    border: `1px solid ${C.rule}`, background: C.paper,
  };

  return (
    <Modal title="Projects" onClose={onClose} width={420}>
      <div style={{ minHeight: 60 }}>
        {projectList.length === 0 && !creating && (
          <div style={{ font: "500 12px Archivo, sans-serif", color: C.inkSoft, padding: "8px 0" }}>
            No projects yet.
          </div>
        )}

        {projectList.map((p) => (
          <div key={p.id} style={{ ...rowBase, background: p.id === currentProjectId ? hexA(C.focus, 0.06) : C.paper, borderColor: p.id === currentProjectId ? hexA(C.focus, 0.4) : C.rule }}>
            {renamingId === p.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(p.id); if (e.key === "Escape") setRenamingId(null); }}
                style={{ flex: 1, font: "600 13px Fraunces, Georgia, serif", color: C.ink, background: "#fff", border: `1px solid ${C.ink}`, borderRadius: 3, padding: "3px 7px" }}
              />
            ) : (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 13px Fraunces, Georgia, serif", color: p.id === currentProjectId ? C.focus : C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                  {p.id === currentProjectId && (
                    <span style={{ font: "500 10px Archivo, sans-serif", color: C.focus, marginLeft: 7 }}>open</span>
                  )}
                </div>
                <div style={{ font: "400 10px 'IBM Plex Mono', monospace", color: C.inkSoft, marginTop: 1 }}>
                  {formatDate(p.updatedAt)} · {p.personCount} {p.personCount === 1 ? "person" : "people"}
                </div>
              </div>
            )}

            {confirmDeleteId === p.id ? (
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ font: "500 10px Archivo, sans-serif", color: C.inkSoft }}>Delete?</span>
                <button style={{ ...btnStyle(true), padding: "2px 7px", fontSize: 11 }} onClick={() => handleDelete(p.id)}>Yes</button>
                <button style={{ ...btnStyle(false), padding: "2px 7px", fontSize: 11 }} onClick={() => setConfirmDeleteId(null)}>No</button>
              </div>
            ) : renamingId === p.id ? (
              <div style={{ display: "flex", gap: 5 }}>
                <button style={{ ...btnStyle(true), padding: "2px 7px", fontSize: 11 }} onClick={() => handleRename(p.id)}>Save</button>
                <button style={{ ...btnStyle(false), padding: "2px 7px", fontSize: 11 }} onClick={() => setRenamingId(null)}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                {p.id !== currentProjectId && (
                  <button style={{ ...btnStyle(false), padding: "2px 7px", fontSize: 11 }} onClick={() => { onOpen(p.id); onClose(); }}>Open</button>
                )}
                <button
                  style={{ ...btnStyle(false), padding: "2px 7px", fontSize: 11 }}
                  onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  style={{ ...btnStyle(false), padding: "2px 7px", fontSize: 11 }}
                  onClick={() => setConfirmDeleteId(p.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}

        {creating ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
              placeholder="Project name"
              style={{ flex: 1, font: "600 13px Fraunces, Georgia, serif", color: C.ink, background: "#fff", border: `1px solid ${C.ink}`, borderRadius: 3, padding: "5px 8px" }}
            />
            <button style={{ ...btnStyle(true), padding: "5px 10px" }} onClick={handleCreate}>Create</button>
            <button style={{ ...btnStyle(false), padding: "5px 10px" }} onClick={() => setCreating(false)}>✕</button>
          </div>
        ) : (
          <button style={{ ...btnStyle(false), marginTop: 10, width: "100%" }} onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>
    </Modal>
  );
}
