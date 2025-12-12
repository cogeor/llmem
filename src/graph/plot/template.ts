export function getHtmlTemplate(graphDataJson: string, title: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style type="text/css">
        #mynetwork {
            width: 100%;
            height: 95vh;
            border: 1px solid lightgray;
        }
        body { font-family: sans-serif; margin: 0; padding: 10px; }
        .controls { margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="controls">
        <h2>${title}</h2>
        <div>Scroll to zoom, drag to pan. Hover for details.</div>
    </div>
    <div id="mynetwork"></div>
    <script type="text/javascript">
        // Data interpolation
        var data = ${graphDataJson};

        // Create a network
        var container = document.getElementById('mynetwork');
        var options = {
            nodes: {
                shape: 'dot',
                size: 16,
                font: {
                    size: 14,
                    color: '#000000'
                },
                borderWidth: 2
            },
            edges: {
                width: 1.5,
                color: { inherit: 'from' },
                arrows: {
                    to: { enabled: true, scaleFactor: 0.5 }
                },
                smooth: {
                    type: 'continuous'
                }
            },
            physics: {
                stabilization: false,
                barnesHut: {
                    gravitationalConstant: -2000,
                    springConstant: 0.04,
                    springLength: 95
                }
            },
            interaction: {
                tooltipDelay: 200,
                hover: true
            }
        };
        var network = new vis.Network(container, data, options);
    </script>
</body>
</html>
`;
}
