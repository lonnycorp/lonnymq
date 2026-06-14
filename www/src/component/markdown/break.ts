import { node } from "@lonnycorp/htmlforge"

export class Break implements node.Buildable {
    private readonly root = new node.Element("br")

    build() {
        return this.root.build()
    }
}
