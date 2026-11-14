const vscode = require('vscode');
const { lint } = require('./lib/rules');
const { imageTree } = require('./lib/tree');

const SEV = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information };

function activate(context) {
  const coll = vscode.languages.createDiagnosticCollection('ifslint');
  const out = vscode.window.createOutputChannel('QNX image tree');
  const refresh = (doc) => {
    if (doc.languageId !== 'qnx-buildfile') return;
    const ds = lint(doc.getText()).map((d) => {
      const r = new vscode.Range(d.range.line - 1, d.range.col, d.range.line - 1, Math.max(d.range.endCol, d.range.col + 1));
      const diag = new vscode.Diagnostic(r, d.hint ? `${d.message}\nhint: ${d.hint}` : d.message, SEV[d.severity]);
      diag.code = d.code;
      diag.source = 'ifslint';
      return diag;
    });
    coll.set(doc.uri, ds);
  };
  context.subscriptions.push(
    coll,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => coll.delete(d.uri)),
    vscode.commands.registerCommand('ifslint.showTree', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      out.clear();
      out.appendLine(imageTree(ed.document.getText()));
      out.show(true);
    })
  );
  vscode.workspace.textDocuments.forEach(refresh);
}
function deactivate() {}
module.exports = { activate, deactivate };
