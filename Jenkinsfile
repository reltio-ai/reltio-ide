pipelineSetCommonProperties()

def nodeVersion

pipeline {
    agent {
        node {
            label 'ec2-slave-ui'
        }
    }

    stages {
        stage('Get image') {
            steps {
                script {
                    nodeVersion = nodeAppGetEcrImage()
                }
            }
        }

        stage('ECR login') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'ecr-credentials',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY',
                        usernameVariable: 'AWS_ACCESS_KEY_ID'
                    )
                ]) {
                    sh '''
                        export AWS_DEFAULT_REGION=us-east-1
                        TOKEN=$(aws ecr get-login-password --region us-east-1)
                        echo $TOKEN | docker login --username AWS --password-stdin 114312229468.dkr.ecr.us-east-1.amazonaws.com
                    '''
                }
            }
        }

        stage('Install') {
            agent {
                docker {
                    image "${nodeVersion}"
                    reuseNode true
                }
            }
            steps {
                bitbucketNotify('reltio-ide', 'INPROGRESS')
                sshagent(credentials: ['bitbucket-ssh']) {
                    sh "mkdir -p ~/.ssh"
                    sh "ssh-keyscan bitbucket.org >> ~/.ssh/known_hosts"
                    sh 'npm ci'
                }
            }
        }

        stage('Build') {
            agent {
                docker {
                    image "${nodeVersion}"
                    reuseNode true
                }
            }
            steps {
                sh 'npm run build'
            }
        }

        stage('Test') {
            agent {
                docker {
                    image "${nodeVersion}"
                    reuseNode true
                }
            }
            steps {
                sh 'npm run test'
            }
        }

        stage('Sonar Scan') {
            agent {
                docker {
                    image 'registry.test-dev.reltio.com/reltio/sonar-scanner'
                    reuseNode true
                }
            }
            steps {
                sonarAnalyze('reltio-ide')
            }
        }
    }
    

    post {
        always {
            bitbucketNotifyStatus('reltio-ide')
        }
    }
}
