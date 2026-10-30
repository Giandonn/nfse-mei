# Fórmula do Homebrew (modelo: o workflow "instalador" troca @VERSAO@ e @SHA256@ e anexa o resultado na Release).
# Vai num tap: repositório github.com/Giandonn/homebrew-tap, arquivo Formula/nfse-mei.rb.
# Quem usa: brew install giandonn/tap/nfse-mei
class NfseMei < Formula
  desc "Emite a NFS-e do MEI no Emissor Nacional e configura tudo por um passo a passo"
  homepage "https://github.com/Giandonn/nfse-mei"
  url "https://github.com/Giandonn/nfse-mei/releases/download/v@VERSAO@/nfse-mei-@VERSAO@.tgz"
  sha256 "@SHA256@"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      O nfse-mei usa o Google Chrome para entrar no portal. Se não tiver:
        brew install --cask google-chrome
      Para configurar tudo, rode:
        nfse-mei
    EOS
  end

  test do
    assert_match "abre o PAINEL", shell_output("#{bin}/nfse-mei ajuda")
  end
end
